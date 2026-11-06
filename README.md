# Local Voice

Speech recognition that runs on a rooted LG webOS TV. The remote's microphone button and apps with their own, such as YouTube, get their text from a model on the TV instead of LG's cloud service, with no changes to the app. Audio is never saved or sent anywhere.

Tested on one TV so far: an OLED55BX6LB (webOS 5.4.3, MR20 remote). Other models are untested.

## How it works

Web apps ask the TV's browser engine for speech recognition, and the engine calls LG's `com.webos.service.voiceconductor`. Local Voice stands in for that service:

1. A request or a press of the remote's button arrives and the card shows **Listening**, with bars that follow how loud the voice is. The bars and the meter on the app's page turn red at the level that counts as speech. Only the level goes to them, never any audio.
2. The service opens the remote's microphone through LG's own `voiceinput`.
3. It stops after 1.2 s of quiet, after 7 s with no speech, or at about 10 s.
4. Moonshine, through sherpa-onnx, turns the audio into text on the TV.
5. An app that asked receives the text as its speech result. Otherwise it is typed through LG's input service.

The card is a small companion app, `com.haywire.localvoice.card`, which Local Voice installs when it turns on and removes when it turns off.

The swap lasts until a reboot: a bind mount hides LG's program and the service takes its name. Nothing in the system's folders changes. Turning Local Voice off, or a reboot with it off, puts LG's service back.

## Install

Needs root and the Homebrew Channel.

1. In Homebrew Channel, open **Settings**, choose **Add repository** and enter `https://haywirephoenix.github.io/webos-localvoice/apps.json`.
2. Install **Local Voice** from the list of apps. Updates appear there too.
3. Open **Local Voice** and choose **Turn on**.

Or download the `.ipk` from [Releases](https://github.com/haywirephoenix/webos-localvoice/releases) and install it with `ares-install`. After an update, turn Local Voice off and on again.

With [lifesgoodwithoutspying](https://github.com/lewisdoesstuff/lifesgoodwithoutspying), its **Voice** switch also stops `voiceinput`, which supplies the microphone. Turn on its **Keep microphone service** setting to leave `voiceinput` running while LG's other voice services stay stopped. Local Voice never overrides that app: while `voiceinput` is stopped, the app and the press of a microphone button say so, and voice resumes by itself once it is back. Turning Local Voice off leaves that app's stubs in place, and LG's service only returns if nothing else is hiding it. Turn Local Voice off before removing the app.

## Use

Hold the remote's microphone button, speak, and let go. A quick press also works: it listens until you pause. A card at the bottom of the screen shows **Listening**, then **Recognising**, then what it heard, and the app beneath keeps focus throughout.

The text goes into the selected text box, followed by Enter. With a text box selected, a toast shows **Listening** instead of the card, because a new window would close the on-screen keyboard and the box could no longer take text. In YouTube, whose search box is not a real text box, it starts a search. Anywhere else the card shows the words and nothing is typed.

An app's own microphone button works the same way, with the text going to that app. Each press is one phrase. To try it, open **Local Voice**, whose page shows your words in a box of its own, without the keyboard or any typing. To try real typing, use a text box in another app, such as the Web Browser's address bar.

## Using it from another app

Check for the app with `luna://com.webos.applicationManager/getAppInfo` (`{"id":"com.haywire.localvoice"}`), then call the usual method. Replies arrive in order, ending with `sessionEnd`:

```sh
luna-send -i luna://com.webos.service.voiceconductor/recognizeVoiceWithDetails '{"autoEndDetection":true,"subscribe":true}'
```

| `event` | Meaning |
|---|---|
| `registered`, `sttStart` | The request was accepted |
| `sttVoiceLevel` | `level`, 0 to 100, while listening |
| `sttResult` | `text`, an array holding the phrase; absent if nothing was recognised |
| `sttEnd`, `sessionEnd` | Finished |

`cancelRecognition` with the `voiceTicket` of a reply ends a phrase early.

## Build

```sh
pip install ziglang
python tools/build.py
```

`tools/build.py` downloads the engine, model and libraries into `.cache`, checks each against a pinned SHA-256, compiles `native/lvengine.c` for 32-bit ARM, and writes `dist/com.haywire.localvoice_<version>_all.ipk`.

Run the tests with `node tests/detector.test.js` and `node tests/ctl.test.js`.

## Debugging

The log is at `/tmp/localvoice/log.txt`. It leaves out what was said unless `debug=1` is added to `/var/lib/webosbrew/localvoice.conf`, which also logs audio levels.

## Licence

MIT, see [LICENSE](LICENSE). The package contains third-party software, listed in [THIRD-PARTY.md](THIRD-PARTY.md).
