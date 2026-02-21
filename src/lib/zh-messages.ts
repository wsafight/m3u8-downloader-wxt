/**
 * Single source of truth for Chinese downloader / live-recorder messages.
 *
 * Both `default-messages.ts` (used as fallback in business-logic classes)
 * and `i18n.svelte.ts` (used in the UI) reference this file so that
 * translations only need to be updated in one place.
 *
 * This is a plain TypeScript module with no Svelte runes so it is safe to
 * import in test environments without a Svelte compiler.
 */

export const ZH_DL = {
  fetchingPlaylist: '正在获取播放列表…',
  noStreamsInMaster: 'Master playlist 中没有可用流',
  fetchingStream: (label: string) => `获取媒体流 (${label})…`,
  noSegmentsInMedia: '媒体播放列表中没有分片',
  fetchingInitSegment: '获取初始化分片…',
  segmentInfo: (total: number, fmt: string, dur: string) =>
    `共 ${total} 个分片 (${fmt})，时长约 ${dur}，开始并发下载…`,
  restoredFromCache: (count: number) =>
    `已从缓存恢复 ${count} 个分片，继续下载剩余分片…`,
  segmentFailed: (index: number) => `分片 ${index} 下载失败`,
  someSegmentsFailed: (count: number) =>
    `${count} 个分片失败，可点击"重新下载失败片段"重试`,
  noFailedSegments: '没有失败的分片',
  retryingFailed: (count: number) => `重试 ${count} 个失败分片…`,
  segmentRetryFailed: (index: number) => `分片 ${index} 重试失败`,
  stillFailed: (count: number) => `仍有 ${count} 个分片失败`,
  retryComplete: '重试完成，正在合并…',
  merging: '正在合并分片…',
  noOkSegments: '没有已成功的分片',
  savingPartial: (count: number) => `正在保存 ${count} 个已完成分片…`,
  savedPartial: (count: number, mb: string) => `已保存 ${count} 个分片（${mb} MB）`,
  convertingMp4: '正在转换为 MP4…',
  mp4ConvertDone: 'MP4 转换完成',
  mp4ConvertFailed: (msg: string) => `MP4 转换失败（${msg}），将保存为 .ts`,
  prepareSave: '准备保存文件…',
  downloadComplete: (segs: number, mb: string) => `下载完成！${segs} 个分片，${mb} MB`,
  networkError: (url: string) => `网络请求失败，请检查连接（${url}）`,
  http403: (url: string) =>
    `403 拒绝访问 — 该流可能需要登录或 Referer，请刷新视频页面后重新触发下载（${url}）`,
  http404: (url: string) => `404 未找到 — 链接已失效或分片已过期（${url}）`,
  http429: (url: string) => `429 请求过于频繁 — 尝试降低并发数后重试（${url}）`,
  httpServer: (status: number, url: string) => `${status} 服务器错误 — 稍后重试（${url}）`,
  httpGeneric: (status: number, url: string) => `HTTP ${status}（${url}）`,
  aes128MissingKey: 'AES-128 加密但缺少密钥 URI',
  circuitOpen: (n: number) =>
    `连续 ${n} 个分片失败，已自动中止下载以防止无效重试`,
  audioTrackDownloading: '正在下载独立音频轨道…',
  audioTrackDone: '音频轨道下载完成',
  audioTrackFailed: (msg: string) => `音频轨道下载失败：${msg}`,
} as const;

export const ZH_LR = {
  startRecording: '开始录制直播流…',
  playlistFailed: (status: number) => `播放列表请求失败：HTTP ${status}，3 秒后重试`,
  fetchFailed: (msg: string) => `拉取播放列表失败：${msg}，3 秒后重试`,
  streamEnded: '直播流已结束',
  segmentFailed: (err: string, url: string) => `分片下载失败（${err}），已跳过: ${url}`,
  mergingRecording: '正在合并录制内容…',
  recordingDone: (count: number, mb: string) => `录制完成！${count} 片，${mb} MB`,
  aes128MissingKey: 'AES-128 加密但缺少密钥 URI',
  keyFetchFailed: (status: number) => `密钥请求失败：HTTP ${status}`,
  tooManyErrors: (n: number) =>
    `连续 ${n} 次请求失败，流已不可达，自动停止录制`,
} as const;
