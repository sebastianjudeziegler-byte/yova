"use client";

import { useState } from "react";
import { AlertCircle, Check, CirclePlay, Link2, Newspaper, Sparkles } from "lucide-react";
import type { LearningMaterial } from "@/lib/domain";
import { importLinkedMaterial, MATERIAL_LIMITS } from "@/lib/materials/intake";

export function MaterialLinkImporter({
  existingCount,
  disabled = false,
  onImported,
}: {
  existingCount: number;
  disabled?: boolean;
  onImported: (material: LearningMaterial, notice: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [videoTitle, setVideoTitle] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atLimit = existingCount >= MATERIAL_LIMITS.maxFiles;

  const submit = async () => {
    if (!url.trim() || working || disabled || atLimit) return;
    setWorking(true);
    setError(null);
    try {
      const result = await importLinkedMaterial(url.trim(), videoTitle ? transcript : undefined);
      if (result.status === "transcript_required") {
        setVideoTitle(result.source.title);
        return;
      }
      onImported(result.material, result.extraction.notice);
      setUrl("");
      setTranscript("");
      setVideoTitle(null);
      setOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "YOVA could not import this link.");
    } finally {
      setWorking(false);
    }
  };

  if (!open) {
    return <button className="material-link-trigger" type="button" disabled={disabled || atLimit} onClick={() => setOpen(true)}><Link2 size={17} /><span><strong>Add an article or YouTube video</strong><small>Public article text or a YouTube transcript can become plan material.</small></span></button>;
  }

  return <section className="material-link-importer" aria-label="Add material from a link">
    <header><span><Link2 size={17} /></span><div><strong>Add material from a link</strong><small>YOVA stores a private text copy for this learning goal.</small></div></header>
    <div className="material-link-kinds"><span><Newspaper size={14} /> Public article</span><span><CirclePlay size={15} /> YouTube transcript</span></div>
    <label><span>Article or YouTube URL</span><input type="url" inputMode="url" autoComplete="url" maxLength={2_000} placeholder="https://..." value={url} disabled={working || Boolean(videoTitle)} onChange={(event) => { setUrl(event.target.value); setError(null); setVideoTitle(null); setTranscript(""); }} /></label>
    {videoTitle && <div className="transcript-step"><div className="transcript-heading"><CirclePlay size={18} /><div><span>VIDEO FOUND</span><strong>{videoTitle}</strong></div></div><p>On YouTube, open the video description, choose <strong>Show transcript</strong>, copy the transcript, then paste it below.</p><label><span>Video transcript</span><textarea rows={7} maxLength={50_000} placeholder="Paste the complete transcript here..." value={transcript} disabled={working} onChange={(event) => { setTranscript(event.target.value); setError(null); }} /><small>{transcript.length.toLocaleString()} of 50,000 characters</small></label></div>}
    {error && <p className="material-error"><AlertCircle size={15} /> {error}</p>}
    <footer><button className="button ghost" type="button" disabled={working} onClick={() => { setOpen(false); setVideoTitle(null); setTranscript(""); setError(null); }}>Cancel</button>{videoTitle && <button className="button ghost" type="button" disabled={working} onClick={() => { setVideoTitle(null); setTranscript(""); setError(null); }}>Change link</button>}<button className="button primary" type="button" disabled={!url.trim() || working || (Boolean(videoTitle) && transcript.trim().length < 80)} onClick={() => void submit()}>{working ? <><span className="button-spinner" /> {videoTitle ? "Saving transcript" : "Reading link"}</> : videoTitle ? <><Check size={16} /> Add video transcript</> : <><Sparkles size={16} /> Read this link</>}</button></footer>
    <small className="material-link-boundary">YOVA imports public pages only. It does not bypass paywalls or sign-ins. YouTube requires a pasted transcript so the source is explicit and reliable.</small>
  </section>;
}
