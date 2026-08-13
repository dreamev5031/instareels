import assert from "node:assert/strict";
import test from "node:test";
import { ElevenLabsApiError, fetchElevenLabsVoice, synthesizeElevenLabsSpeech } from "./client";

function withFetch(handler: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = global.fetch;
  global.fetch = handler as typeof fetch;
  return run().finally(() => {
    global.fetch = original;
  });
}

function withApiKey(run: () => Promise<void>): Promise<void> {
  const original = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-key";
  return run().finally(() => {
    if (original === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = original;
  });
}

test("missing API key fails fast with ELEVENLABS_NOT_CONFIGURED before any network call", async () => {
  const original = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await assert.rejects(fetchElevenLabsVoice("abc"), (error: unknown) => {
      assert.ok(error instanceof ElevenLabsApiError);
      assert.equal(error.code, "ELEVENLABS_NOT_CONFIGURED");
      return true;
    });
  } finally {
    if (original !== undefined) process.env.ELEVENLABS_API_KEY = original;
  }
});

test("a 404 voice lookup maps to VOICE_NOT_FOUND", () =>
  withApiKey(() =>
    withFetch(
      async () => new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 }),
      async () => {
        await assert.rejects(fetchElevenLabsVoice("nonexistent"), (error: unknown) => {
          assert.ok(error instanceof ElevenLabsApiError);
          assert.equal(error.code, "VOICE_NOT_FOUND");
          assert.equal(error.status, 404);
          return true;
        });
      },
    ),
  ));

test("a valid voice lookup returns name, preview_url, and labels; uses xi-api-key header", () =>
  withApiKey(() =>
    withFetch(
      async (input, init) => {
        assert.equal((init?.headers as Record<string, string>)["xi-api-key"], "test-key");
        assert.match(String(input), /\/v1\/voices\/abc123$/);
        return new Response(
          JSON.stringify({ voice_id: "abc123", name: "Rachel", preview_url: "https://example.com/p.mp3", labels: { accent: "american" } }),
          { status: 200 },
        );
      },
      async () => {
        const info = await fetchElevenLabsVoice("abc123");
        assert.equal(info.voiceId, "abc123");
        assert.equal(info.name, "Rachel");
        assert.equal(info.previewUrl, "https://example.com/p.mp3");
        assert.deepEqual(info.labels, { accent: "american" });
      },
    ),
  ));

test("a 401 quota_exceeded body maps to ELEVENLABS_QUOTA_EXCEEDED, not a generic API error", () =>
  withApiKey(() =>
    withFetch(
      async () =>
        new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }), { status: 401 }),
      async () => {
        await assert.rejects(synthesizeElevenLabsSpeech("abc123", "안녕하세요", "eleven_multilingual_v2"), (error: unknown) => {
          assert.ok(error instanceof ElevenLabsApiError);
          assert.equal(error.code, "ELEVENLABS_QUOTA_EXCEEDED");
          return true;
        });
      },
    ),
  ));

test("with-timestamps hits the /with-timestamps endpoint and returns audio + alignment together", () =>
  withApiKey(() =>
    withFetch(
      async (input, init) => {
        assert.match(String(input), /\/v1\/text-to-speech\/abc123\/with-timestamps$/);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.text, "안녕하세요");
        assert.equal(body.model_id, "eleven_multilingual_v2");
        return new Response(
          JSON.stringify({
            audio_base64: Buffer.from("fake-audio-bytes").toString("base64"),
            alignment: { characters: ["안", "녕"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] },
          }),
          { status: 200 },
        );
      },
      async () => {
        const result = await synthesizeElevenLabsSpeech("abc123", "안녕하세요", "eleven_multilingual_v2");
        assert.equal(result.audio.toString(), "fake-audio-bytes");
        assert.ok(result.alignment);
        assert.deepEqual(result.alignment!.characters, ["안", "녕"]);
      },
    ),
  ));

test("a generic 500 failure maps to ELEVENLABS_API_ERROR", () =>
  withApiKey(() =>
    withFetch(
      async () => new Response("internal error", { status: 500 }),
      async () => {
        await assert.rejects(fetchElevenLabsVoice("abc123"), (error: unknown) => {
          assert.ok(error instanceof ElevenLabsApiError);
          assert.equal(error.code, "ELEVENLABS_API_ERROR");
          return true;
        });
      },
    ),
  ));
