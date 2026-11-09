# Local Voice

Speech recognition that runs on a rooted LG webOS TV. The remote's microphone button, and apps with their own such as YouTube, get their text from a model on the TV instead of LG's cloud service, with no changes to the apps. Audio is never saved or sent anywhere.

Looking for testers! Built on an OLED55BX6LB (webOS 5.4.3, MR20 remote). If you try it on another TV, send a report from the app's **Compatibility** card: it's anonymous, and the results go in [COMPATIBILITY.md](COMPATIBILITY.md).

- Hold the remote's microphone button and speak: the words go into the selected text box, or into a YouTube search.
- Apps with their own microphone button get the words as their speech result.
- A card shows a live voice level, then what was heard, without taking focus from the app beneath.
- Speech models are downloaded in the app, from a fixed list, each checked against a pinned checksum.
- Nothing about what you say or do is logged unless you turn on the debug log.
- Nothing is sent anywhere unless you press **Send** on the Compatibility card. A report holds the TV's model, webOS and firmware versions, the app version and your yes or no answers.

## Install

Needs root and the Homebrew Channel.

1. In Homebrew Channel, open **Settings**, choose **Add repository** and enter `https://haywirephoenix.github.io/webos-homebrew/apps.json`, which lists Local Voice and [Tailscale](https://github.com/haywirephoenix/webos-tailscale). The older address, `.../webos-localvoice/apps.json`, still works.
2. Install **Local Voice** from the list of apps.
3. Open **Local Voice**, choose **Turn on**, then download a model in **Speech models**.

After an update, turn Local Voice off and on again. With lifesgoodwithoutspying's **Voice** switch on, the microphone is stopped too: see [Installing](https://github.com/haywirephoenix/webos-localvoice/wiki/Installing).

## Documentation

The [wiki](https://github.com/haywirephoenix/webos-localvoice/wiki) covers [using Local Voice](https://github.com/haywirephoenix/webos-localvoice/wiki/Using-Local-Voice), [speech models](https://github.com/haywirephoenix/webos-localvoice/wiki/Speech-models), [privacy and logging](https://github.com/haywirephoenix/webos-localvoice/wiki/Privacy-and-logging), [troubleshooting](https://github.com/haywirephoenix/webos-localvoice/wiki/Troubleshooting), [how it works](https://github.com/haywirephoenix/webos-localvoice/wiki/How-it-works), and [building it or using it from another app](https://github.com/haywirephoenix/webos-localvoice/wiki/For-developers).

## Build

```sh
pip install ziglang
python tools/build.py
```

Run the tests with `node tests/detector.test.js`, `node tests/ctl.test.js`, `node tests/models.test.js` and `python tests/compat.test.py`.

Compatibility reports go through a small Cloudflare Worker, [webos-compat](https://github.com/haywirephoenix/webos-compat), shared with Tailscale.

## Licence

MIT, see [LICENSE](LICENSE). The package includes third-party libraries, listed in [THIRD-PARTY.md](THIRD-PARTY.md). Speech models are downloaded separately.
