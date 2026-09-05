import { useEffect, useRef, useState } from "react";
import { api } from "../api";

interface Props {
  caseId: string;
  questionId: string;
  disabled: boolean;
  onTranscript: (text: string) => void;
  onBusy: (busy: boolean) => void;
}

export default function VoiceControls({ caseId, questionId, disabled, onTranscript, onBusy }: Props) {
  const [configured, setConfigured] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const player = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const canceled = useRef(false);

  const release = () => {
    window.clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    player.current?.pause();
    player.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  };
  const finish = () => {
    release();
    if (alive.current) { setPhase("idle"); onBusy(false); }
  };
  useEffect(() => {
    alive.current = true;
    void api.voiceStatus().then(result => { if (alive.current) setConfigured(result.configured); }).catch(() => { if (alive.current) setNotice("Voice service unavailable; typing still works."); });
    return () => {
      alive.current = false;
      controller.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      onBusy(false);
    };
  }, []); // This component is keyed by case, question and follow-up.

  useEffect(() => {
    if (!disabled) return;
    canceled.current = true;
    controller.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    finish();
  }, [disabled]);

  const start = () => {
    setNotice(""); onBusy(true);
    controller.current = new AbortController();
    timer.current = window.setTimeout(() => controller.current?.abort(), 65_000);
    return controller.current.signal;
  };
  const fail = (error: unknown) => {
    if (alive.current) setNotice(error instanceof Error ? error.message : "Voice failed. You can still type your reply.");
    finish();
  };
  const speak = async () => {
    const signal = start(); setPhase("loading");
    try {
      const response = await api.voice(`/cases/${encodeURIComponent(caseId)}/questions/${encodeURIComponent(questionId)}/speech`, signal);
      const blob = await response.blob();
      if (!alive.current || signal.aborted) return;
      window.clearTimeout(timer.current);
      audioUrl.current = URL.createObjectURL(blob);
      player.current = new Audio(audioUrl.current);
      player.current.onended = finish;
      player.current.onerror = () => fail(new Error("Audio playback failed."));
      await player.current.play();
      if (alive.current) setPhase("playing");
    } catch (error) { fail(error); }
  };
  const record = async () => {
    canceled.current = false;
    setNotice(""); setPhase("permission"); onBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("This browser cannot record audio. Use a supported browser or type your reply.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || canceled.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("No supported audio recording format is available.");
      const current = new MediaRecorder(media, { mimeType: mime });
      recorder.current = current;
      const chunks: Blob[] = [];
      let size = 0;
      current.ondataavailable = event => {
        chunks.push(event.data); size += event.data.size;
        if (size > 5 * 1024 * 1024 && current.state === "recording") current.stop();
      };
      current.onerror = () => { canceled.current = true; fail(new Error("Microphone recording failed.")); };
      current.onstop = async () => {
        release();
        if (!alive.current || canceled.current) return;
        if (size > 5 * 1024 * 1024) { fail(new Error("Recording exceeded 5 MB. Please try a shorter answer.")); return; }
        const signal = start(); setPhase("transcribing");
        try {
          const response = await api.voice("/voice/transcribe", signal, new Blob(chunks, { type: mime }));
          const result = await response.json() as { text: string };
          if (alive.current && !signal.aborted) {
            onTranscript(result.text);
            setNotice("Transcript added below. Review it before sending.");
          }
          finish();
        } catch (error) { fail(error); }
      };
      current.start(500); setPhase("recording");
      timer.current = window.setTimeout(() => { if (current.state === "recording") current.stop(); }, 60_000);
    } catch (error) { fail(error); }
  };
  const busy = phase !== "idle";
  return <div className="voice-controls">
    <div className="voice-actions">
      <button type="button" disabled={disabled || !configured || (busy && phase !== "playing")} onClick={() => phase === "playing" ? finish() : void speak()}>{phase === "playing" ? "Stop playback" : "Listen to Saul"}</button>
      <button type="button" disabled={disabled || !configured || (busy && phase !== "recording")} onClick={() => phase === "recording" ? recorder.current?.stop() : void record()}>{phase === "recording" ? "Stop & transcribe" : "Record reply"}</button>
    </div>
    <small>Voice uses ElevenLabs. Audio is sent for transcription; questions are sent for speech. Up to 60 seconds. Review before sending.</small>
    <div role="status">{phase === "recording" ? "Recording… microphone is on." : busy ? `${phase}…` : notice || (!configured ? "Voice is not configured." : "")}</div>
  </div>;
}
