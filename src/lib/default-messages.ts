/**
 * Default (Chinese) fallback messages for M3U8Downloader and LiveRecorder.
 *
 * Keeping these in a dedicated module means the core business-logic files
 * (downloader.ts, live-recorder.ts) are free of embedded UI strings while
 * still providing a zero-config out-of-the-box experience.
 *
 * In production the download page always passes fully translated messages
 * via i18n.svelte.ts; these defaults are only used in tests and in the
 * rare case where a caller creates the downloader/recorder without messages.
 */

import type { DownloaderMessages } from './downloader';
import type { LiveRecorderMessages } from './live-recorder';

export const ZH_DOWNLOADER_MESSAGES: DownloaderMessages = {
  fetchingPlaylist: '正在获取播放列表…',
  noStreamsInMaster: 'Master playlist 中没有可用流',
  fetchingStream: (label) => `获取媒体流 (${label})…`,
  noSegmentsInMedia: '媒体播放列表中没有分片',
  fetchingInitSegment: '获取初始化分片…',
  segmentInfo: (total, fmt, dur) => `共 ${total} 个分片 (${fmt})，时长约 ${dur}，开始并发下载…`,
  restoredFromCache: (count) => `已从缓存恢复 ${count} 个分片，继续下载剩余分片…`,
  segmentFailed: (index) => `分片 ${index} 下载失败`,
  someSegmentsFailed: (count) => `${count} 个分片失败，可点击"重新下载失败片段"重试`,
  noFailedSegments: '没有失败的分片',
  retryingFailed: (count) => `重试 ${count} 个失败分片…`,
  segmentRetryFailed: (index) => `分片 ${index} 重试失败`,
  stillFailed: (count) => `仍有 ${count} 个分片失败`,
  retryComplete: '重试完成，正在合并…',
  merging: '正在合并分片…',
  noOkSegments: '没有已成功的分片',
  savingPartial: (count) => `正在保存 ${count} 个已完成分片…`,
  savedPartial: (count, mb) => `已保存 ${count} 个分片（${mb} MB）`,
  convertingMp4: '正在转换为 MP4…',
  mp4ConvertDone: 'MP4 转换完成',
  mp4ConvertFailed: (msg) => `MP4 转换失败（${msg}），将保存为 .ts`,
  prepareSave: '准备保存文件…',
  downloadComplete: (segs, mb) => `下载完成！${segs} 个分片，${mb} MB`,
  networkError: (url) => `网络请求失败，请检查连接（${url}）`,
  http403: (url) =>
    `403 拒绝访问 — 该流可能需要登录或 Referer，请刷新视频页面后重新触发下载（${url}）`,
  http404: (url) => `404 未找到 — 链接已失效或分片已过期（${url}）`,
  http429: (url) => `429 请求过于频繁 — 尝试降低并发数后重试（${url}）`,
  httpServer: (status, url) => `${status} 服务器错误 — 稍后重试（${url}）`,
  httpGeneric: (status, url) => `HTTP ${status}（${url}）`,
  aes128MissingKey: 'AES-128 加密但缺少密钥 URI',
  circuitOpen: (n) => `连续 ${n} 个分片失败，已自动中止下载以防止无效重试`,
};

export const ZH_RECORDER_MESSAGES: LiveRecorderMessages = {
  startRecording: '开始录制直播流…',
  playlistFailed: (status) => `播放列表请求失败：HTTP ${status}，3 秒后重试`,
  fetchFailed: (msg) => `拉取播放列表失败：${msg}，3 秒后重试`,
  streamEnded: '直播流已结束',
  segmentFailed: (err, url) => `分片下载失败（${err}），已跳过: ${url}`,
  mergingRecording: '正在合并录制内容…',
  recordingDone: (count, mb) => `录制完成！${count} 片，${mb} MB`,
  aes128MissingKey: 'AES-128 加密但缺少密钥 URI',
  keyFetchFailed: (status) => `密钥请求失败：HTTP ${status}`,
};
