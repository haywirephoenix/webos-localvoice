/* lvengine: keeps a speech model loaded and turns audio into text, over pipes.
 *
 * Usage: lvengine <model dir> [threads]
 * Prints "READY" once the model is loaded. Then, for each request on stdin:
 *   int32 little-endian sample count, then that many int16 samples at 16 kHz mono
 * it prints "TEXT <text>" on one line. It exits at the end of stdin, so it never
 * outlives the service that started it, and it opens no network port.
 *
 * Linked against libsherpa-onnx-c-api.so (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx).
 * The model's files say what it is: Moonshine (encoder_model.ort), a NeMo transducer such as
 * Parakeet (encoder.int8.onnx), or a Zipformer transducer (encoder-epoch-99-avg-1.int8.onnx).
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "sherpa-onnx/c-api/c-api.h"

#define RATE 16000
#define MAX_SAMPLES (RATE * 30)

static int read_all(void *to, size_t n) {
  return fread(to, 1, n, stdin) == n;
}

static void path(char *to, size_t size, const char *dir, const char *name) {
  snprintf(to, size, "%s/%s", dir, name);
}

static int has(const char *dir, const char *name) {
  char p[512];
  path(p, sizeof p, dir, name);
  return access(p, R_OK) == 0;
}

int main(int argc, char **argv) {
  if (argc != 2 && argc != 3) {
    fprintf(stderr, "usage: lvengine <model dir> [threads]\n");
    return 2;
  }
  const char *dir = argv[1];
  char encoder[512], decoder[512], joiner[512], tokens[512];
  path(tokens, sizeof tokens, dir, "tokens.txt");

  SherpaOnnxOfflineRecognizerConfig config;
  memset(&config, 0, sizeof config);
  config.feat_config.sample_rate = RATE;
  config.feat_config.feature_dim = 80;
  if (has(dir, "encoder_model.ort")) {
    path(encoder, sizeof encoder, dir, "encoder_model.ort");
    path(decoder, sizeof decoder, dir, "decoder_model_merged.ort");
    config.model_config.moonshine.encoder = encoder;
    config.model_config.moonshine.merged_decoder = decoder;
  } else {
    const char *suffix = has(dir, "encoder.int8.onnx") ? ".int8.onnx" : "-epoch-99-avg-1.int8.onnx";
    char name[64];
    snprintf(name, sizeof name, "encoder%s", suffix);
    path(encoder, sizeof encoder, dir, name);
    snprintf(name, sizeof name, "decoder%s", suffix);
    path(decoder, sizeof decoder, dir, name);
    snprintf(name, sizeof name, "joiner%s", suffix);
    path(joiner, sizeof joiner, dir, name);
    config.model_config.transducer.encoder = encoder;
    config.model_config.transducer.decoder = decoder;
    config.model_config.transducer.joiner = joiner;
    if (has(dir, "encoder.int8.onnx")) config.model_config.model_type = "nemo_transducer";
  }
  config.model_config.tokens = tokens;
  config.model_config.num_threads = argc == 3 ? atoi(argv[2]) : 2;
  config.model_config.provider = "cpu";
  config.decoding_method = "greedy_search";

  const SherpaOnnxOfflineRecognizer *recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
  if (!recognizer) {
    fprintf(stderr, "lvengine: the model did not load from %s\n", dir);
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
