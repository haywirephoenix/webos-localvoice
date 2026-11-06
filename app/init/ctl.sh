#!/bin/sh
# Local Voice control, run as root through the Homebrew Channel's exec. Each command prints one
# line of JSON.
#   ctl.sh status    what is on and whether it runs
#   ctl.sh enable    remember it, start it now and at every boot
#   ctl.sh disable   stop it, forget it, and give LG's service back
#   ctl.sh start     start if enabled (boot.sh runs this)
#   ctl.sh stop      give LG's service back, for now
#   ctl.sh heard     the last phrase, for the card, once
#   ctl.sh typed     the last phrase, for this app's page, once
#   ctl.sh tune      let the next phrase set the speech level
#   ctl.sh tuned     how that went, once
#   ctl.sh speech N  set the speech level by hand
#
# The swap survives only until a reboot: a bind mount hides LG's program and the running service
# takes its name. Nothing in the system's folders is changed.
HERE=$(cd "$(dirname "$(realpath "$0")")" && pwd)
APP=$(dirname "$HERE")
RUN=/tmp/localvoice
CONF=/var/lib/webosbrew/localvoice.conf
SPEECH=/var/lib/webosbrew/localvoice.speech
LINK=/var/lib/webosbrew/init.d/60-localvoice
EXE=/usr/sbin/voiceconductor
INPUT=/usr/sbin/voiceinput
UNIT=voiceconductor.service
CARD=com.haywire.localvoice.card
NAME=com.webos.service.voiceconductor
MOUNTS=/proc/self/mountinfo
# lifesgoodwithoutspying answers for this name with a stand-in. Its claim file asks it to step
# aside while a pid lives. LG's program stays hidden either way.
CLAIM=/tmp/lifesgoodwithoutspying.claim.$NAME
STANDIN=/tmp/lifesgoodwithoutspying.answer.$NAME.pid
export NODE_PATH=/usr/lib/nodejs

json() { printf '{"ok":%s,"enabled":%s,"running":%s,"blocked":%s,"speech":%s,"error":"%s"}\n' "$1" "$(enabled_json)" "$(running_json)" "$(blocked_json)" "$(speech_json)" "$2"; }
speech_json() { [ -s "$SPEECH" ] && cat "$SPEECH" || echo 150; }
is_enabled() { grep -q '^enabled=1$' "$CONF" 2>/dev/null; }
enabled_json() { is_enabled && echo true || echo false; }
pid_running() {
    [ -f "$RUN/node.pid" ] || return 1
    p=$(cat "$RUN/node.pid")
    case " $(tr '\000' ' ' 2>/dev/null < "/proc/$p/cmdline") " in
        *"/service/standin.js "*) return 0 ;;
    esac
    return 1
}
running_json() { pid_running && echo true || echo false; }
# lifesgoodwithoutspying's Voice toggle stubs voiceinput too, and without it there is no mic,
# unless its Keep microphone service setting leaves voiceinput alone. That is the user's choice
# to make there: this only reads the result.
is_blocked() { grep -q " $INPUT " /proc/mounts; }
blocked_json() { is_blocked && echo true || echo false; }

# What is bound over LG's program, oldest first. lifesgoodwithoutspying may bind there too.
stack() { awk -v p="$EXE" '$5 == p { print $4 }' "$MOUNTS"; }
ours_on_top() {
    case "$(stack | tail -n 1)" in
        */localvoice/stub) return 0 ;;
    esac
    return 1
}
ours_below() { ! ours_on_top && stack | grep -q '/localvoice/stub$'; }

hide_lg() {
    # Anyone's stub hides it. Never bind over theirs: they could not then clear their own.
    [ -n "$(stack)" ] && return 0
    printf '#!/bin/sh\nexit 0\n' > "$RUN/stub"
    chmod 755 "$RUN/stub"
    # The hub starts the service on demand, so the real program must be hidden before it stops.
    mount --bind "$RUN/stub" "$EXE" || return 1
    systemctl --no-block stop "$UNIT"
    n=0
    while pidof voiceconductor >/dev/null 2>&1 && [ "$n" -lt 12 ]; do
        sleep 1
        n=$((n + 1))
    done
    p=$(pidof voiceconductor)
    [ -n "$p" ] && kill $p
    return 0
}
# Takes off our stub and nothing else. Another stub means someone still wants LG's service off,
# so it stays and the service is not started.
give_back() {
    n=0
    while ours_on_top && [ "$n" -lt 5 ]; do
        umount "$EXE" 2>/dev/null || umount -l "$EXE" 2>/dev/null
        n=$((n + 1))
    done
    [ -z "$(stack)" ] && systemctl --no-block start "$UNIT"
}
claim_name() {
    echo "$1" > "$CLAIM"
    [ -f "$STANDIN" ] || return 0
    p=$(cat "$STANDIN")
    case " $(tr '\000' ' ' 2>/dev/null < "/proc/$p/cmdline") " in
        *"/nospy-luna-stub.js "*) kill -KILL "$p" ;;
    esac
}
# A window's type is fixed per app and a package holds one app, so the card ships as a package
# inside this one. Without it the service falls back to toasts.
card_call() {
    luna-send -i "luna://com.webos.appInstallService/dev/$1" "$2" >/dev/null 2>&1 &
    p=$!
    sleep 10
    kill "$p" 2>/dev/null
}
install_card() {
    grep -qs "$(cat "$APP/card/version")" "/media/developer/apps/usr/palm/applications/$CARD/appinfo.json" && return
    card_call install "{\"id\":\"$CARD\",\"ipkUrl\":\"$APP/card/card.ipk\",\"subscribe\":true}"
}
remove_card() { card_call remove "{\"id\":\"$CARD\",\"subscribe\":true}"; }

start() {
    mkdir -p "$RUN"
    ( trap '' HUP; install_card ) </dev/null >/dev/null 2>&1 &
    pid_running && { json true ""; return; }
    if is_blocked; then
        json false "the microphone service is turned off"
        return
    fi
    if ! hide_lg; then
        json false "could not hide LG's service"
        return
    fi
    touch "$RUN/keep"
    # Restarts the service if it exits, and gives LG's service back when it keeps failing.
    (
        trap '' HUP
        fails=0
        while [ -f "$RUN/keep" ] && [ "$fails" -lt 5 ]; do
            began=$(cut -d. -f1 /proc/uptime)
            # A stub cleared while this ran left LG's program able to start in the gap.
            hide_lg
            node "$APP/service/standin.js" </dev/null >>"$RUN/node.out" 2>&1 &
            pid=$!
            echo "$pid" > "$RUN/node.pid"
            claim_name "$pid"
            wait "$pid"
            [ $(($(cut -d. -f1 /proc/uptime) - began)) -ge 60 ] && fails=0 || fails=$((fails + 1))
            [ -f "$RUN/keep" ] && sleep 3
        done
        if [ -f "$RUN/keep" ]; then
            rm -f "$RUN/keep" "$RUN/node.pid" "$CLAIM"
            give_back
        fi
    ) </dev/null >/dev/null 2>&1 &
    n=0
    while ! pid_running && [ "$n" -lt 5 ]; do
        sleep 1
        n=$((n + 1))
    done
    pid_running && json true "" || json false "the service did not start"
}
stop() {
    rm -f "$RUN/keep"
    if [ -f "$RUN/node.pid" ]; then
        kill "$(cat "$RUN/node.pid")" 2>/dev/null
        rm -f "$RUN/node.pid"
    fi
    rm -f "$CLAIM"
    sleep 1
    if ! ours_below; then
        give_back
        return
    fi
    # lifesgoodwithoutspying's stub is mounted on top of ours, so unmounting now would undo its
    # stub rather than ours. Wait for it to clear its own, unless this service starts again.
    (
        trap '' HUP
        while ours_below && [ ! -f "$RUN/keep" ]; do
            sleep 10
        done
        [ -f "$RUN/keep" ] || give_back
    ) </dev/null >/dev/null 2>&1 &
}

case "$1" in
    status) json true "" ;;
    heard|typed|tuned)
        cat "$RUN/$1" 2>/dev/null || echo '{}'
        echo
        rm -f "$RUN/$1"
        ;;
    tune)
        mkdir -p "$RUN"
        rm -f "$RUN/tuned"
        touch "$RUN/tune"
        json true ""
        ;;
    speech)
        case "$2" in
            ''|*[!0-9]*) json false "not a number" ;;
            *) echo "$2" > "$SPEECH"; json true "" ;;
        esac
        ;;
    start)
        if is_enabled; then start; else json false "not enabled"; fi
        ;;
    stop)
        stop
        json true ""
        ;;
    enable)
        echo enabled=1 > "$CONF"
        ln -sf "$HERE/boot.sh" "$LINK"
        start
        ;;
    disable)
        rm -f "$CONF" "$LINK"
        stop
        ( trap '' HUP; remove_card ) </dev/null >/dev/null 2>&1 &
        json true ""
        ;;
    *)
        echo "usage: $0 status | enable | disable | start | stop | heard | typed | tune | tuned | speech N" >&2
        exit 2
        ;;
esac
