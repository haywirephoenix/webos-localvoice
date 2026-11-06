/* lvengine: keeps a speech model loaded and turns audio into text, over pipes.
 *
 * Usage: lvengine <model dir>
 * Prints "READY" once the model is loaded. Then, for each request on stdin:
 *   int32 little-endian sample count, then that many int16 samples at 16 kHz mono
 * it prints "TEXT <text>" on one line. It exits at the end of stdin, so it never
 * outlives the service that started it, and it opens no network port.
 *
 * Linked against libsherpa-onnx-c-api.so (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx).
 * Moonshine models only for now.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sherpa-onnx/c-api/c-api.h"

#define RATE 16000
#define MAX_SAMPLES (RATE * 30)

static int read_all(void *to, size_t n) {
  return fread(to, 1, n, stdin) == n;
}

static void path(char *to, size_t size, const char *dir, const char *name) {
  snprintf(to, size, "%s/%s", dir, name);
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: lvengine <model dir>\n");
    return 2;
  }
  char encoder[512], decoder[512], tokens[512];
  path(encoder, sizeof encoder, argv[1], "encoder_model.ort");
  path(decoder, sizeof decoder, argv[1], "decoder_model_merged.ort");
  path(tokens, sizeof tokens, argv[1], "tokens.txt");

  SherpaOnnxOfflineRecognizerConfig config;
  memset(&config, 0, sizeof config);
  config.feat_config.sample_rate = RATE;
  config.feat_config.feature_dim = 80;
  config.model_config.moonshine.encoder = encoder;
  config.model_config.moonshine.merged_decoder = decoder;
  config.model_config.tokens = tokens;
  config.model_config.num_threads = 2;
  config.model_config.provider = "cpu";
  config.decoding_method = "greedy_search";

  const SherpaOnnxOfflineRecognizer *recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
  if (!recognizer) {
    fprintf(stderr, "lvengine: the model did not load from %s\n", argv[1]);
    return 1;
  }
  int16_t *pcm = malloc(MAX_SAMPLES * sizeof *pcm);
  float *samples = malloc(MAX_SAMPLES * sizeof *samples);
  if (!pcm || !samples) return 1;

  puts("READY");
  fflush(stdout);

  int32_t n;
  while (read_all(&n, sizeof n)) {
    if (n < 0 || n > MAX_SAMPLES) {
      fprintf(stderr, "lvengine: bad sample count %d\n", (int)n);
      return 1;
    }
    if (!read_all(pcm, (size_t)n * sizeof *pcm)) return 0;
    for (int32_t i = 0; i < n; i++) samples[i] = pcm[i] / 32768.0f;

    const SherpaOnnxOfflineStream *stream = SherpaOnnxCreateOfflineStream(recognizer);
    SherpaOnnxAcceptWaveformOffline(stream, RATE, samples, n);
    SherpaOnnxDecodeOfflineStream(recognizer, stream);
    const SherpaOnnxOfflineRecognizerResult *result = SherpaOnnxGetOfflineStreamResult(stream);

    fputs("TEXT ", stdout);
    for (const char *c = result ? result->text : ""; c && *c; c++) putchar(*c == '\n' ? ' ' : *c);
    putchar('\n');
    fflush(stdout);

    if (result) SherpaOnnxDestroyOfflineRecognizerResult(result);
    SherpaOnnxDestroyOfflineStream(stream);
  }
  SherpaOnnxDestroyOfflineRecognizer(recognizer);
  return 0;
}
