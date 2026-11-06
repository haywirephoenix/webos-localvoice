#!/bin/sh
# Run at boot through /var/lib/webosbrew/init.d. Waits in the background: an init.d script must
# exit, and LG's services need a moment to settle before one of them is swapped.
HERE=$(cd "$(dirname "$(realpath "$0")")" && pwd)
(sleep 20; sh "$HERE/ctl.sh" start) </dev/null >/dev/null 2>&1 &
exit 0
