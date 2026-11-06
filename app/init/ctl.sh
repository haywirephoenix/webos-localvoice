#!/bin/sh
# Local Voice control, run as root through the Homebrew Channel's exec. Each command prints one
# line of JSON.
#   ctl.sh status    what is on and whether it runs
#   ctl.sh enable    remember it, start it now and at every boot
#   ctl.sh disable   stop it, forget it, and give LG's service back
#   ctl.sh start     start if enabled (boot.sh runs this)
#   ctl.sh stop      give LG's service back, for now
#
# The swap survives only until a reboot: a bind mount hides LG's program and the running service
# takes its name. Nothing in the system's folders is changed.
HERE=$(cd "$(dirname "$(realpath "$0")")" && pwd)
APP=$(dirname "$HERE")
RUN=/tmp/localvoice
CONF=/var/lib/webosbrew/localvoice.conf
LINK=/var/lib/webosbrew/init.d/60-localvoice
EXE=/usr/sbin/voiceconductor
INPUT=/usr/sbin/voiceinput
UNIT=voiceconductor.service
NAME=com.webos.service.voiceconductor
MOUNTS=/proc/self/mountinfo
# lifesgoodwithoutspying answers for this name with a stand-in. Its claim file asks it to step
# aside while a pid lives. LG's program stays hidden either way.
CLAIM=/tmp/lifesgoodwithoutspying.claim.$NAME
STANDIN=/tmp/lifesgoodwithoutspying.answer.$NAME.pid
export NODE_PATH=/usr/lib/nodejs

json() { printf '{"ok":%s,"enabled":%s,"running":%s,"blocked":%s,"error":"%s"}\n' "$1" "$(enabled_json)" "$(running_json)" "$(blocked_json)" "$2"; }
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
start() {
    mkdir -p "$RUN"
    pid_running && { json true ""; return; }
    if is_blocked; then
        json false "the Voice switch of lifesgoodwithoutspying stops the microphone"
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
        json true ""
        ;;
    *)
        echo "usage: $0 status | enable | disable | start | stop" >&2
        exit 2
        ;;
esac
