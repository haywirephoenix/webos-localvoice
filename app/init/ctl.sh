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
#   ctl.sh untune    withdraw a tune that has not happened yet
#   ctl.sh speech N  set the speech level by hand
#   ctl.sh button M  how the remote's button works: none, hold or click
#   ctl.sh words W   whether the card shows the words heard: on or off
#   ctl.sh toasts T  whether messages may show as toasts: on or off (the default)
#   ctl.sh engine P  performance: always (the default) keeps the model loaded, demand loads it
#                    when the button is pressed and unloads it when unused
#   ctl.sh models C  speech models: see service/models.js
#   ctl.sh debug on  log each phrase, words included, to $RUN/log.txt
#   ctl.sh debug off stop, and delete the log
#   ctl.sh info      the TV's model, webOS and firmware versions and this app's version, for a
#                    compatibility report
#
# The swap survives only until a reboot: a bind mount hides LG's program and the running service
# takes its name. Nothing in the system's folders is changed.
HERE=$(cd "$(dirname "$(realpath "$0")")" && pwd)
APP=$(dirname "$HERE")
RUN=/tmp/localvoice
CONF=/var/lib/webosbrew/localvoice.conf
SPEECH=/var/lib/webosbrew/localvoice.speech
BUTTON=/var/lib/webosbrew/localvoice.button
MODEL=/var/lib/webosbrew/localvoice.model
DEBUG=/var/lib/webosbrew/localvoice.debug
LINK=/var/lib/webosbrew/init.d/60-localvoice
WORDS=/var/lib/webosbrew/localvoice.nowords
TOASTS=/var/lib/webosbrew/localvoice.toasts
ENGINE=/var/lib/webosbrew/localvoice.engine
EXE=/usr/sbin/voiceconductor
INPUT=/usr/sbin/voiceinput
UNIT=voiceconductor.service
CARD=com.haywire.localvoice.card
NAME=com.webos.service.voiceconductor
MOUNTS=/proc/self/mountinfo
# lifesgoodwithoutspying stubs voiceinput, which supplies the microphone, while its Voice switch is
# on, and answers for this service's name with a stand-in. This app asks for two exceptions while it
# is turned on: to keep voiceinput, and to claim the name from the stand-in. Each counts only once
# the user turns it on in lifesgoodwithoutspying's Exceptions tab and applies; until then the
# microphone stays off. It is asked to apply after each change.
ID=com.haywire.localvoice
LGWS_EXCEPT=/var/lib/webosbrew/lifesgoodwithoutspying.exceptions.d/$ID
LGWS_OLD_KEEP=/var/lib/webosbrew/lifesgoodwithoutspying.keep.d/$ID
LGWS_APPLIED=/var/lib/webosbrew/lifesgoodwithoutspying.conf-applied
LGWS_CTL=/media/developer/apps/usr/palm/applications/ooo.lew.lifesgoodwithoutspying/init/nospy-ctl.sh
LGWS_LINK=/var/lib/webosbrew/init.d/50-lifesgoodwithoutspying
# The claim holds the pid of this service, its start time and this app's id, so that a pid reused
# after it exits claims nothing. LG's program stays hidden either way.
CLAIM=/tmp/lifesgoodwithoutspying.claim.$NAME
STANDIN=/tmp/lifesgoodwithoutspying.answer.$NAME.pid
export NODE_PATH=/usr/lib/nodejs

json() { printf '{"ok":%s,"enabled":%s,"running":%s,"blocked":%s,"speech":%s,"button":"%s","model":"%s","debug":%s,"words":%s,"toasts":%s,"engine":"%s","loaded":%s,"engine_mb":%s,"free_mb":%s,"need_mb":%s,"error":"%s"}\n' "$1" "$(enabled_json)" "$(running_json)" "$(blocked_json)" "$(speech_json)" "$(button_json)" "$(model_json)" "$(debug_json)" "$(words_json)" "$(toasts_json)" "$(engine_json)" "$(loaded_json)" "$(engine_mb)" "$(free_mb)" "$(need_mb)" "$2"; }
engine_json() { [ "$(cat "$ENGINE" 2>/dev/null)" = demand ] && echo demand || echo always; }
# The speech engine's pid while its model is loaded, and the memory it holds.
engine_pid() {
    p=$(cat "$RUN/engine.pid" 2>/dev/null)
    [ -n "$p" ] && grep -qs lvengine "/proc/$p/cmdline" && echo "$p"
}
loaded_json() { [ -n "$(engine_pid)" ] && echo true || echo false; }
engine_mb() {
    p=$(engine_pid)
    [ -n "$p" ] && awk '/^VmRSS:/ { printf "%d", $2 / 1024; f = 1 } END { if (!f) print 0 }' "/proc/$p/status" || echo 0
}
# What the model needed when it last could not load for lack of memory, or 0.
need_mb() { awk '{ print $2 + 0; f = 1 } END { if (!f) print 0 }' "$RUN/low-memory" 2>/dev/null || echo 0; }
free_mb() { awk '/^MemAvailable:/ { printf "%d", $2 / 1024 }' /proc/meminfo; }
total_mb() { awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo; }
# The memory an engine still loading its model holds so far, or 0.
loading_mb() {
    p=$(cat "$RUN/engine-loading" 2>/dev/null)
    if [ -n "$p" ] && grep -qs lvengine "/proc/$p/cmdline"; then
        awk '/^VmRSS:/ { printf "%d", $2 / 1024; f = 1 } END { if (!f) print 0 }' "/proc/$p/status"
    else
        echo 0
    fi
}
toasts_json() { [ -f "$TOASTS" ] && echo true || echo false; }
words_json() { [ -f "$WORDS" ] && echo false || echo true; }
debug_json() { [ -f "$DEBUG" ] && echo true || echo false; }
model_json() { cat "$RUN/engine-model" 2>/dev/null; }
button_json() { [ -s "$BUTTON" ] && cat "$BUTTON" || echo hold; }
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
# unless the user allows this app's exception for it there. That is the user's choice
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
# Process $1's start time, in clock ticks since boot: field 22 of its stat, counted from the last
# ")" as the name can hold spaces.
start_time() { sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20; }
# Exit 0 if the user allowed this app's exception $1 (keep:voiceinput or claim:<service>) in
# lifesgoodwithoutspying, and applied it.
lgws_allows() { [ "$(grep "^exception\.$ID:$1=" "$LGWS_APPLIED" 2>/dev/null | tail -n 1)" = "exception.$ID:$1=on" ]; }
# lifesgoodwithoutspying's stand-in pid, if it is answering for this name.
standin_pid() {
    [ -f "$STANDIN" ] || return 1
    p=$(cat "$STANDIN")
    case " $(tr '\000' ' ' 2>/dev/null < "/proc/$p/cmdline") " in
        *"/nospy-luna-stub.js "*) echo "$p"; return 0 ;;
    esac
    return 1
}
claim_name() {
    echo "$1 $(start_time "$1") $ID" > "$CLAIM"
    lgws_allows "claim:$NAME" || return 0
    p=$(standin_pid) && kill -KILL "$p"
}
# A window's type is fixed per app and a package holds one app, so the card ships as a package
# inside this one. Without it the service falls back to toasts.
card_call() {
    luna-send -i "luna://com.webos.appInstallService/dev/$1" "$2" >/dev/null 2>&1 &
    p=$!
    sleep 10
    kill "$p" 2>/dev/null
}
# Applies lifesgoodwithoutspying's settings, if it is installed and turned on. It runs as a job of
# its own and returns at once.
lgws_apply() {
    [ -L "$LGWS_LINK" ] && [ -f "$LGWS_CTL" ] && sh "$LGWS_CTL" apply >/dev/null 2>&1
}
register() {
    mkdir -p "$(dirname "$LGWS_EXCEPT")"
    printf 'keep voiceinput\nclaim %s\n' "$NAME" > "$LGWS_EXCEPT"
    rm -f "$LGWS_OLD_KEEP"
}
# Why the microphone is off, naming lifesgoodwithoutspying's setting when that is the reason.
blocked_reason() {
    if [ -f "$LGWS_EXCEPT" ] && ! lgws_allows keep:voiceinput; then
        echo "the microphone service is turned off: allow Local Voice in lifesgoodwithoutspying's Exceptions tab"
    else
        echo "the microphone service is turned off"
    fi
}
install_card() {
    grep -qs "$(cat "$APP/card/version")" "/media/developer/apps/usr/palm/applications/$CARD/appinfo.json" && return
    card_call install "{\"id\":\"$CARD\",\"ipkUrl\":\"$APP/card/card.ipk\",\"subscribe\":true}"
}
remove_card() { card_call remove "{\"id\":\"$CARD\",\"subscribe\":true}"; }

start() {
    # The log and what the service keeps are for root alone.
    umask 077
    mkdir -p "$RUN"
    chmod 700 "$RUN"
    node "$APP/service/models.js" migrate >/dev/null 2>&1
    ( trap '' HUP; install_card ) </dev/null >/dev/null 2>&1 &
    pid_running && { json true ""; return; }
    if is_blocked; then
        json false "$(blocked_reason)"
        return
    fi
    # Its stand-in would hold the name this service needs.
    if standin_pid >/dev/null && ! lgws_allows "claim:$NAME"; then
        json false "lifesgoodwithoutspying answers for voice: allow Local Voice in its Exceptions tab"
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
    info)
        sys=$(luna-send -n 1 luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName","firmwareVersion","sdkVersion"]}' 2>/dev/null | tail -n 1)
        case "$sys" in "{"*) ;; *) sys='{}' ;; esac
        release=$(nyx-cmd OSInfo query webos_release 2>/dev/null | tr -cd '0-9.')
        version=$(sed -n 's/.*"version": *"\([0-9.]*\)".*/\1/p' "$APP/appinfo.json")
        printf '{"system":%s,"webos":"%s","version":"%s"}\n' "$sys" "$release" "$version"
        ;;
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
    untune)
        rm -f "$RUN/tune" "$RUN/tuned"
        json true ""
        ;;
    speech)
        case "$2" in
            ''|*[!0-9]*) json false "not a number" ;;
            *) echo "$2" > "$SPEECH"; json true "" ;;
        esac
        ;;
    button)
        case "$2" in
            none|hold|click) echo "$2" > "$BUTTON"; json true "" ;;
            *) json false "not a button mode" ;;
        esac
        ;;
    engine)
        case "$2" in
            always) rm -f "$ENGINE" ;;
            demand) echo demand > "$ENGINE" ;;
            *) json false "always or demand"; exit 0 ;;
        esac
        pid_running && kill -USR1 "$(cat "$RUN/node.pid")"
        json true ""
        ;;
    toasts)
        case "$2" in
            on) touch "$TOASTS"; json true "" ;;
            off) rm -f "$TOASTS"; json true "" ;;
            *) json false "on or off" ;;
        esac
        ;;
    words)
        case "$2" in
            on) rm -f "$WORDS"; json true "" ;;
            off) touch "$WORDS"; json true "" ;;
            *) json false "on or off" ;;
        esac
        ;;
    # Node takes over 2 s to start on the TV, too long to poll, so progress is read from here.
    debug)
        case "$2" in
            on) touch "$DEBUG"; json true "" ;;
            off) rm -f "$DEBUG" "$RUN/log.txt" "$RUN/log.txt.old"; json true "" ;;
            *) json false "on or off" ;;
        esac
        ;;
    modelstate)
        # Also what the panel's bars show: the disk models go on, the TV's memory, and how far a
        # model has loaded.
        disk=$(df -m /media/developer | awk 'END { print $(NF - 4), $(NF - 3), $(NF - 2) }')
        set -- $disk
        printf '{"free":%s,"chosen":"%s","running":"%s","job":%s,"disk_total":%s,"disk_used":%s,"mem_total":%s,"mem_free":%s,"engine_mb":%s,"loading_mb":%s}\n' \
            "$3" "$(cat "$MODEL" 2>/dev/null)" "$(cat "$RUN/engine-model" 2>/dev/null)" \
            "$(cat "$RUN/model-job" 2>/dev/null || echo null)" "$1" "$2" "$(total_mb)" "$(free_mb)" \
            "$(engine_mb)" "$(loading_mb)"
        ;;
    models)
        mkdir -p "$RUN"
        shift
        node "$APP/service/models.js" "$@"
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
        register
        # lifesgoodwithoutspying has the microphone stubbed: start once its apply gives it back.
        if is_blocked && lgws_apply; then
            (
                trap '' HUP
                n=0
                while is_blocked && [ "$n" -lt 90 ]; do
                    sleep 2
                    n=$((n + 2))
                done
                start
            ) </dev/null >/dev/null 2>&1 &
            json true ""
        else
            start
        fi
        ;;
    disable)
        rm -f "$CONF" "$LINK" "$LGWS_EXCEPT" "$LGWS_OLD_KEEP"
        stop
        # So that lifesgoodwithoutspying stubs the microphone again.
        lgws_apply
        ( trap '' HUP; remove_card ) </dev/null >/dev/null 2>&1 &
        json true ""
        ;;
    *)
        echo "usage: $0 status | enable | disable | start | stop | heard | typed | tune | tuned | untune | speech N | button M | words W | toasts T | engine P | models C | modelstate | debug on|off" >&2
        exit 2
        ;;
esac
