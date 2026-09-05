"""Explicit, user-triggered ElevenLabs transport; recordings are not stored."""
import os
import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

LIMIT = 5 * 1024 * 1024
MIMES = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav"}


class VoiceError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


async def error_handler(request, exc):
    return JSONResponse(status_code=exc.status, content={"error": {"code": "VOICE_ERROR", "message": exc.message}})


def guard(request):
    origin = request.headers.get("origin")
    if request.headers.get("sec-fetch-site") == "cross-site" or (origin and urlparse(origin).hostname not in {"localhost", "127.0.0.1", "::1"}):
        raise VoiceError(403, "Voice requests must originate from the local app.")
    if not os.getenv("ELEVENLABS_API_KEY"):
        raise VoiceError(503, "ElevenLabs is not configured on the backend.")


async def provider(path, **kwargs):
    try:
        async with httpx.AsyncClient(timeout=50) as client:
            response = await client.post("https://api.elevenlabs.io/v1/" + path, headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]}, **kwargs)
    except httpx.HTTPError as exc:
        raise VoiceError(502, "Could not reach ElevenLabs. Please try again.") from exc
    if response.status_code >= 400:
        message = {401: "ElevenLabs rejected the API key.", 403: "The ElevenLabs key lacks permission for this voice operation.", 402: "ElevenLabs requires additional credits.", 429: "ElevenLabs is busy or your quota has been reached."}.get(response.status_code, "ElevenLabs could not process this voice request.")
        raise VoiceError(502, message)
    return response


def create_router(store):
    router = APIRouter()

    @router.get("/api/voice/status")
    async def status():
        return {"configured": bool(os.getenv("ELEVENLABS_API_KEY")), "maxAudioBytes": LIMIT, "maxDurationSeconds": 60}

    @router.post("/api/voice/transcribe")
    async def transcribe(request: Request):
        guard(request)
        mime = request.headers.get("content-type", "").split(";")[0].lower()
        if mime not in MIMES:
            raise VoiceError(415, "Unsupported recording format.")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > LIMIT:
                raise VoiceError(413, "Recordings must be smaller than 5 MB.")
        if not data:
            raise VoiceError(422, "The recording was empty.")
        response = await provider("speech-to-text", files={"file": ("recording." + MIMES[mime], bytes(data), mime)}, data={"model_id": os.getenv("ELEVENLABS_STT_MODEL", "scribe_v2"), "tag_audio_events": "false", "diarize": "false"})
        try:
            payload = response.json()
            text = payload.get("text") if isinstance(payload, dict) else None
        except ValueError:
            text = None
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise VoiceError(502, "No usable transcript returned. Try a shorter recording or type your response.")
        return {"text": text.strip()}

    @router.post("/api/cases/{case_id}/questions/{question_id}/speech")
    async def speech(case_id: str, question_id: str, request: Request):
        guard(request)
        case = store.get_case(case_id)
        question = next((q for q in case.questions if q.id == question_id), None)
        if question is None:
            raise VoiceError(404, "Question not found.")
        text = question.followUp.text if question.followUp else question.text
        if len(text) > 4000:
            raise VoiceError(422, "This question is too long for voice playback.")
        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
        if not re.fullmatch(r"[A-Za-z0-9]+", voice_id):
            raise VoiceError(503, "The configured voice ID is invalid.")
        response = await provider("text-to-speech/" + voice_id, params={"output_format": "mp3_44100_128"}, json={"text": text, "model_id": os.getenv("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")})
        if not response.headers.get("content-type", "").startswith("audio/"):
            raise VoiceError(502, "ElevenLabs returned an unexpected audio response.")
        return Response(response.content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})

    return router
