"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface ChannelInfo {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

interface ChannelResponse {
  connected: boolean;
  authConfigured?: boolean;
  authUrl: string | null;
  channel?: ChannelInfo | null;
}

interface VideoItem {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationIso: string;
}

interface Summary {
  totalVideos: number;
  totalViews: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  topVideo: { id: string; title: string; viewCount: number } | null;
  postsByHour: number[];
  postsByWeekday: number[];
}

interface Recommendations {
  summary: string;
  bestPostingTimes: string[];
  contentThemes: { theme: string; rationale: string }[];
  titleImprovements: { original: string; suggested: string; why: string }[];
  growthActions: string[];
}

interface UploadRow {
  id: number;
  title: string;
  description: string;
  privacy_status: string;
  publish_at: string | null;
  status: string;
  youtube_video_id: string | null;
  error: string | null;
  created_at: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function YouTubePage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.youtubePage;

  const [status, setStatus] = useState<ChannelResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [videosLoading, setVideosLoading] = useState(false);
  const [recs, setRecs] = useState<Recommendations | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState<"public" | "unlisted" | "private">("public");
  const [publishAt, setPublishAt] = useState("");
  const [posting, setPosting] = useState(false);
  const [postMessage, setPostMessage] = useState("");

  const [uploads, setUploads] = useState<UploadRow[]>([]);

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<
    | { total: number; updated: number; skipped: number; failed: number; target: string }
    | null
  >(null);

  useEffect(() => {
    fetchStatus();
    fetchUploads();
  }, []);

  useEffect(() => {
    if (status?.connected) {
      fetchVideos();
    }
  }, [status?.connected]);

  async function fetchStatus() {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/youtube/channel");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false, authUrl: null });
    } finally {
      setStatusLoading(false);
    }
  }

  async function fetchVideos() {
    setVideosLoading(true);
    try {
      const res = await fetch("/api/youtube/videos?max=25");
      const data = await res.json();
      if (Array.isArray(data.videos)) {
        setVideos(data.videos);
        setSummary(data.summary);
      }
    } catch {
      // ignore
    } finally {
      setVideosLoading(false);
    }
  }

  async function fetchUploads() {
    try {
      const res = await fetch("/api/youtube/upload");
      const data = await res.json();
      if (Array.isArray(data.uploads)) {
        setUploads(data.uploads);
      }
    } catch {
      // ignore
    }
  }

  function handleConnect() {
    if (!status?.authUrl) {
      setPostMessage(t.notConfigured);
      return;
    }
    window.location.href = status.authUrl;
  }

  async function handleDisconnect() {
    if (!confirm(t.disconnectConfirm)) return;
    await fetch("/api/youtube/channel", { method: "DELETE" });
    setStatus({ connected: false, authUrl: status?.authUrl || null });
    setVideos([]);
    setSummary(null);
    setRecs(null);
  }

  async function handleGenerateRecs() {
    if (!status?.channel || videos.length === 0) return;
    setRecsLoading(true);
    setRecsError("");
    try {
      const res = await fetch("/api/youtube/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: {
            title: status.channel.title,
            description: status.channel.description,
            subscriberCount: status.channel.subscriberCount,
            videoCount: status.channel.videoCount,
            viewCount: status.channel.viewCount,
          },
          videos: videos.map((v) => ({
            id: v.id,
            title: v.title,
            publishedAt: v.publishedAt,
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
          })),
        }),
      });
      const data = await res.json();
      if (data.recommendations) {
        setRecs(data.recommendations);
      } else {
        setRecsError(data.error || t.recsFailed);
      }
    } catch {
      setRecsError(t.recsFailed);
    } finally {
      setRecsLoading(false);
    }
  }

  async function handleUpload() {
    if (!title || !videoUrl) return;
    setPosting(true);
    setPostMessage("");
    try {
      const tags = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/youtube/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          tags,
          videoUrl,
          privacyStatus,
          publishAt: publishAt ? new Date(publishAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPostMessage(publishAt ? t.scheduled : t.published);
        setTitle("");
        setDescription("");
        setTagsInput("");
        setVideoUrl("");
        setPublishAt("");
        fetchUploads();
      } else {
        setPostMessage(`${t.uploadFailed}: ${data.error || "unknown error"}`);
      }
    } catch {
      setPostMessage(t.uploadFailed);
    } finally {
      setPosting(false);
    }
  }

  async function runBulkPrivacy(target: "public" | "unlisted" | "private") {
    const labelMap: Record<string, string> = {
      public: t.privacyPublic,
      unlisted: t.privacyUnlisted,
      private: t.privacyPrivate,
    };
    if (!confirm(t.bulkConfirm.replace("{target}", labelMap[target]))) return;
    setBulkRunning(true);
    setBulkResult(null);
    try {
      const res = await fetch("/api/youtube/bulk-privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacyStatus: target }),
      });
      const data = await res.json();
      if (typeof data.total === "number") {
        setBulkResult(data);
        fetchVideos();
      } else {
        alert(data.error || t.recsFailed);
      }
    } catch {
      alert(t.recsFailed);
    } finally {
      setBulkRunning(false);
    }
  }

  if (!user) return null;

  const peakHour = summary
    ? summary.postsByHour.indexOf(Math.max(...summary.postsByHour))
    : 0;

  return (
    <DashboardShell user={user}>
      <div className="max-w-5xl mx-auto space-y-6 p-4 sm:p-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {/* Connection */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.accountInfo}</h2>
          {statusLoading ? (
            <div className="text-gray-500">Loading...</div>
          ) : status?.connected && status.channel ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                {status.channel.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={status.channel.thumbnailUrl}
                    alt={status.channel.title}
                    className="w-16 h-16 rounded-full border border-gray-200"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-green-700 font-medium">{t.connected}</span>
                  </div>
                  <div className="text-base font-semibold text-gray-900 mt-1 truncate">
                    {status.channel.title}
                  </div>
                  <div className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                    {status.channel.description}
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-xs text-gray-500 hover:text-red-600 underline transition-colors shrink-0"
                >
                  {t.disconnect}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm pt-3 border-t border-gray-100">
                <Stat label={t.subscribers} value={status.channel.subscriberCount.toLocaleString()} />
                <Stat label={t.totalViews} value={status.channel.viewCount.toLocaleString()} />
                <Stat label={t.totalVideos} value={status.channel.videoCount.toLocaleString()} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-red-500" />
                <span className="text-red-600 font-medium">{t.notConnected}</span>
              </div>
              {status?.authConfigured === false ? (
                <p className="text-amber-700 text-sm">{t.notConfigured}</p>
              ) : (
                <p className="text-gray-500 text-sm">{t.connectDesc}</p>
              )}
              <button
                onClick={handleConnect}
                disabled={!status?.authUrl}
                className="px-4 py-2 bg-[#FF0000] hover:bg-[#cc0000] text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {t.connectAccount}
              </button>
            </div>
          )}
        </div>

        {/* Analysis */}
        {status?.connected && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t.analysisTitle}</h2>
              <button
                onClick={fetchVideos}
                disabled={videosLoading}
                className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-50"
              >
                {videosLoading ? t.loading : t.refresh}
              </button>
            </div>
            {videosLoading && videos.length === 0 ? (
              <div className="text-gray-500 text-sm">{t.loading}</div>
            ) : !summary || summary.totalVideos === 0 ? (
              <div className="text-gray-500 text-sm">{t.noVideos}</div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label={t.recentVideos} value={summary.totalVideos.toString()} />
                  <Stat label={t.avgViews} value={summary.avgViews.toLocaleString()} />
                  <Stat label={t.avgLikes} value={summary.avgLikes.toLocaleString()} />
                  <Stat label={t.avgComments} value={summary.avgComments.toLocaleString()} />
                </div>

                {summary.topVideo && (
                  <div className="text-sm">
                    <span className="text-gray-500">{t.topVideo}:</span>{" "}
                    <a
                      href={`https://youtu.be/${summary.topVideo.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-red-600 hover:underline font-medium"
                    >
                      {summary.topVideo.title}
                    </a>{" "}
                    <span className="text-gray-500">
                      ({summary.topVideo.viewCount.toLocaleString()} {t.views})
                    </span>
                  </div>
                )}

                <div>
                  <div className="text-xs text-gray-500 mb-2">
                    {t.postsByHour} · {t.peakHour}: {String(peakHour).padStart(2, "0")}:00 UTC
                  </div>
                  <div className="flex items-end gap-0.5 h-16">
                    {summary.postsByHour.map((count, h) => {
                      const max = Math.max(...summary.postsByHour, 1);
                      const height = (count / max) * 100;
                      return (
                        <div
                          key={h}
                          className="flex-1 bg-red-200 rounded-t"
                          style={{ height: `${height}%` }}
                          title={`${h}:00 UTC — ${count} posts`}
                        />
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-2">{t.postsByWeekday}</div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs">
                    {summary.postsByWeekday.map((count, d) => (
                      <div key={d} className="space-y-1">
                        <div className="text-gray-500">{WEEKDAY_LABELS[d]}</div>
                        <div className="bg-red-50 rounded py-2 font-medium text-gray-700">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                    {t.recentVideosList}
                  </summary>
                  <div className="mt-3 space-y-2">
                    {videos.slice(0, 10).map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0"
                      >
                        {v.thumbnailUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={v.thumbnailUrl}
                            alt={v.title}
                            className="w-20 h-12 rounded object-cover"
                            referrerPolicy="no-referrer"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <a
                            href={`https://youtu.be/${v.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-gray-900 hover:text-red-600 line-clamp-1"
                          >
                            {v.title}
                          </a>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {v.viewCount.toLocaleString()} {t.views} · {v.likeCount.toLocaleString()}{" "}
                            {t.likes} · {new Date(v.publishedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* Recommendations */}
        {status?.connected && summary && summary.totalVideos > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t.recsTitle}</h2>
              <button
                onClick={handleGenerateRecs}
                disabled={recsLoading}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {recsLoading ? t.recsGenerating : recs ? t.recsRegenerate : t.recsGenerate}
              </button>
            </div>
            {recsError && (
              <div className="text-sm text-red-600 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                {recsError}
              </div>
            )}
            {!recs && !recsLoading ? (
              <p className="text-sm text-gray-500">{t.recsHint}</p>
            ) : recs ? (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-medium text-gray-900 mb-1">{t.recsSummary}</div>
                  <p className="text-gray-700">{recs.summary}</p>
                </div>
                {recs.bestPostingTimes?.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-900 mb-1">{t.recsBestTimes}</div>
                    <div className="flex flex-wrap gap-2">
                      {recs.bestPostingTimes.map((time, i) => (
                        <span key={i} className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs">
                          {time}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {recs.contentThemes?.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">{t.recsThemes}</div>
                    <ul className="space-y-2">
                      {recs.contentThemes.map((theme, i) => (
                        <li key={i} className="text-gray-700">
                          <span className="font-medium">{theme.theme}</span>
                          <span className="text-gray-500"> — {theme.rationale}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {recs.titleImprovements?.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">{t.recsTitles}</div>
                    <ul className="space-y-2">
                      {recs.titleImprovements.map((imp, i) => (
                        <li key={i} className="border-l-2 border-purple-200 pl-3">
                          <div className="text-gray-500 text-xs">{t.recsOriginal}</div>
                          <div className="text-gray-700 line-through">{imp.original}</div>
                          <div className="text-gray-500 text-xs mt-1">{t.recsSuggested}</div>
                          <div className="text-gray-900 font-medium">{imp.suggested}</div>
                          {imp.why && <div className="text-xs text-gray-500 mt-0.5">{imp.why}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {recs.growthActions?.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">{t.recsActions}</div>
                    <ul className="list-disc list-inside space-y-1 text-gray-700">
                      {recs.growthActions.map((action, i) => (
                        <li key={i}>{action}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Channel Management — bulk privacy */}
        {status?.connected && summary && summary.totalVideos > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{t.channelMgmtTitle}</h2>
            <p className="text-sm text-gray-500 mb-4">{t.bulkHint}</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => runBulkPrivacy("public")}
                disabled={bulkRunning}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {bulkRunning ? t.bulkRunning : t.bulkMakePublic}
              </button>
              <button
                onClick={() => runBulkPrivacy("unlisted")}
                disabled={bulkRunning}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {t.bulkMakeUnlisted}
              </button>
              <button
                onClick={() => runBulkPrivacy("private")}
                disabled={bulkRunning}
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {t.bulkMakePrivate}
              </button>
            </div>
            {bulkResult && (
              <div className="mt-3 text-sm p-3 bg-blue-50 text-blue-800 border border-blue-200 rounded-lg">
                {t.bulkResult
                  .replace("{updated}", String(bulkResult.updated))
                  .replace("{skipped}", String(bulkResult.skipped))
                  .replace("{failed}", String(bulkResult.failed))
                  .replace("{total}", String(bulkResult.total))}
              </div>
            )}
          </div>
        )}

        {/* Upload / Schedule */}
        {status?.connected && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.uploadTitle}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.videoTitle}</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.videoDescription}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                  maxLength={5000}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.tagsLabel}</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder={t.tagsPlaceholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.videoUrl}</label>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://example.com/video.mp4"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <p className="text-xs text-gray-500 mt-1">{t.videoUrlHint}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">{t.privacy}</label>
                  <select
                    value={privacyStatus}
                    onChange={(e) =>
                      setPrivacyStatus(e.target.value as "public" | "unlisted" | "private")
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="public">{t.privacyPublic}</option>
                    <option value="unlisted">{t.privacyUnlisted}</option>
                    <option value="private">{t.privacyPrivate}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">{t.publishAt}</label>
                  <input
                    type="datetime-local"
                    value={publishAt}
                    onChange={(e) => setPublishAt(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t.publishAtHint}</p>
                </div>
              </div>
              {postMessage && (
                <div
                  className={`text-sm p-3 rounded-lg border ${
                    postMessage.includes(t.uploadFailed)
                      ? "bg-red-50 text-red-600 border-red-200"
                      : "bg-green-50 text-green-700 border-green-200"
                  }`}
                >
                  {postMessage}
                </div>
              )}
              <button
                onClick={handleUpload}
                disabled={posting || !title || !videoUrl}
                className="px-4 py-2 bg-[#FF0000] hover:bg-[#cc0000] text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {posting ? t.uploading : publishAt ? t.scheduleBtn : t.uploadBtn}
              </button>
            </div>
          </div>
        )}

        {/* Upload history */}
        {uploads.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.historyTitle}</h2>
            <div className="space-y-2">
              {uploads.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{u.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <StatusBadge status={u.status} t={t} />
                      <span className="ml-2">
                        {u.publish_at
                          ? `${t.scheduledFor} ${new Date(u.publish_at).toLocaleString()}`
                          : new Date(u.created_at).toLocaleString()}
                      </span>
                    </div>
                    {u.error && <div className="text-xs text-red-600 mt-0.5 truncate">{u.error}</div>}
                  </div>
                  {u.youtube_video_id && (
                    <a
                      href={`https://youtu.be/${u.youtube_video_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-red-600 hover:underline shrink-0"
                    >
                      {t.viewOnYouTube}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: string;
  t: {
    statusPending: string;
    statusUploading: string;
    statusScheduled: string;
    statusPublished: string;
    statusFailed: string;
  };
}) {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: t.statusPending, color: "bg-gray-100 text-gray-700" },
    uploading: { label: t.statusUploading, color: "bg-blue-100 text-blue-700" },
    scheduled: { label: t.statusScheduled, color: "bg-amber-100 text-amber-700" },
    published: { label: t.statusPublished, color: "bg-green-100 text-green-700" },
    failed: { label: t.statusFailed, color: "bg-red-100 text-red-700" },
  };
  const s = map[status] || { label: status, color: "bg-gray-100 text-gray-700" };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${s.color}`}>{s.label}</span>;
}
