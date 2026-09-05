import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from backend.app import voice


class VoiceTests(unittest.TestCase):
    def request(self, path, **kwargs):
        async def run():
            app = FastAPI()
            question = SimpleNamespace(id="1", text="Question text", followUp=SimpleNamespace(text="Current follow-up"))
            store = SimpleNamespace(get_case=lambda _: SimpleNamespace(questions=[question]))
            app.include_router(voice.create_router(store))
            app.add_exception_handler(voice.VoiceError, voice.error_handler)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as client:
                return await client.post(path, **kwargs)
        return asyncio.run(run())

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-only"})
    def test_validation_does_not_call_provider(self):
        with patch.object(voice, "provider", new_callable=AsyncMock) as provider:
            self.assertEqual(self.request("/api/voice/transcribe", headers={"content-type": "text/plain"}, content=b"a").status_code, 415)
            self.assertEqual(self.request("/api/voice/transcribe", headers={"content-type": "audio/webm"}, content=b"").status_code, 422)
            self.assertEqual(self.request("/api/voice/transcribe", headers={"content-type": "audio/webm"}, content=b"a" * (voice.LIMIT + 1)).status_code, 413)
            self.assertEqual(self.request("/api/voice/transcribe", headers={"origin": "https://example.com"}).status_code, 403)
            provider.assert_not_called()

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""})
    def test_unconfigured(self):
        self.assertEqual(self.request("/api/voice/transcribe").status_code, 503)

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-only"})
    def test_transcript_is_returned_for_review(self):
        with patch.object(voice, "provider", new_callable=AsyncMock, return_value=httpx.Response(200, json={"text": "Test answer"})) as provider:
            result = self.request("/api/voice/transcribe", headers={"content-type": "audio/webm;codecs=opus"}, content=b"test audio")
            self.assertEqual(result.json(), {"text": "Test answer"})
            self.assertEqual(provider.call_args.args[0], "speech-to-text")

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-only"})
    def test_speech_uses_stored_followup(self):
        with patch.object(voice, "provider", new_callable=AsyncMock, return_value=httpx.Response(200, content=b"audio", headers={"content-type": "audio/mpeg"})) as provider:
            result = self.request("/api/cases/test/questions/1/speech")
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.headers["cache-control"], "no-store")
            self.assertEqual(provider.call_args.kwargs["json"]["text"], "Current follow-up")
            self.assertEqual(self.request("/api/cases/test/questions/missing/speech").status_code, 404)


if __name__ == "__main__":
    unittest.main()
