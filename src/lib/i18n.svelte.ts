/** Reactive i18n store — import `i18n` and call `i18n.t(key)` in templates. */
import { ZH_DL, ZH_LR } from './zh-messages';

const zh = {
  // ── Popup Tabs ──────────────────────────────────────────────────
  tabStreams: '检测',
  tabQueue: '队列',
  tabHistory: '历史',
  tabSettings: '设置',

  // ── Popup – Stream List ─────────────────────────────────────────
  streamEmpty: '暂未检测到视频流',
  streamEmptyHint: '播放视频后会自动出现在这里',
  clearAll: '清空',
  selectAll: '全选',
  cancelSelectAll: '取消全选',
  preview: '预览',
  stopPreview: '停止预览',
  directDownload: '直接下载',
  addToQueue: '加入队列',
  removeStream: '移除',
  selectStream: '选择',
  deselectStream: '取消选择',
  selected: '已选',
  streams: '个流',
  batchQueue: '批量入队',
  manualUrl: '手动粘贴 M3U8 / MPD 地址…',
  manualUrlInvalid: '请输入有效的 M3U8 或 MPD 地址（需以 http/https 开头，且 URL 中包含 m3u8/mpd 等关键词）',

  // ── Queue Tab ───────────────────────────────────────────────────
  queueEmpty: '队列为空',
  queueEmptyHint: '在检测到的流中点击加入队列',
  tasks: '个任务',
  clearDone: '清除已完成',
  statusPending: '等待',
  statusDownloading: '下载中',
  statusDone: '完成',
  statusError: '失败',

  // ── History Tab ─────────────────────────────────────────────────
  historyEmpty: '暂无下载记录',
  records: '条记录',
  exportHistory: '导出',
  clearHistory: '清空全部',
  segs: '片',

  // ── Settings Tab ────────────────────────────────────────────────
  settingsTitle: '设置',
  sectionLanguage: '界面语言',
  langZh: '中文',
  langEn: 'English',
  sectionDownload: '下载',
  concurrency: '并发数',
  concurrencyHint: '同时下载的分片数',
  retries: '重试次数',
  retriesHint: '分片失败后的重试次数',
  convertMp4: '转换为 MP4',
  convertMp4Hint: '下载后将 TS 流重新封装为 MP4',
  sectionBehavior: '行为',
  autoEnqueue: '点击下载时自动入队',
  autoEnqueueHint: '不打开下载页面，直接加入队列',
  sectionAbout: '关于',
  version: '版本',
  resetDefaults: '恢复默认',
  viewSource: '查看源码',

  // ── Download Page ───────────────────────────────────────────────
  noUrl: '（未提供地址）',
  streamUrl: 'M3U8 地址',
  liveLabel: 'LIVE',
  settingsLabel: '设置',
  filenameLabel: '文件名',
  concurrencyLabel: '并发数',
  formatLabel: '输出格式',
  formatTs: '原始',
  formatMp4: '兼容',
  qualityLabel: '清晰度',
  bestTag: 'BEST',
  subtitleTracksLabel: '字幕轨道',
  audioTracksLabel: '音频轨道',
  defaultAudio: '默认',
  resumePrompt: '发现未完成的下载，是否继续？',
  resumeDone: (done: number, total: number) => `${done}/${total} 片已完成`,
  continueDownload: '继续',
  freshDownload: '重新下载',
  timeAgoSec: (s: number) => `${s}秒前`,
  timeAgoMin: (m: number) => `${m}分钟前`,
  timeAgoHour: (h: number) => `${h}小时前`,
  timeAgoDay: (d: number) => `${d}天前`,

  // ── ActionButtons ────────────────────────────────────────────────
  btnStartDownload: '开始下载',
  btnStartRec: '开始录制',
  btnAbort: '中止',
  btnStopRec: '停止录制',
  btnPause: '暂停',
  btnResume: '继续下载',
  btnDone: '下载完成',
  btnRetry: '重试',
  btnReset: '重新开始',
  btnRetryFailed: (n: number) => `重新下载失败片段 (${n})`,
  btnSaveComplete: (n: number) => `保存已完成片段 (${n})`,
  btnSavePartial: (n: number) => `保存已完成 (${n})`,
  btnSavePartialTitle: (n: number) => `保存当前已完成的 ${n} 个分片（不中断下载）`,

  // ── Progress phases ──────────────────────────────────────────────
  phasePrefetching: '解析中…',
  phaseDownloading: '下载中',
  phasePaused: '已暂停',
  phaseMerging: '合并中…',
  phasePartial: '部分失败',
  phaseRecording: '录制中',
  phaseStopping: '保存中…',
  phaseDone: '完成！',
  phaseError: '失败',
  phaseAborted: '已中止',

  // ── LogTerminal ──────────────────────────────────────────────────
  logTitle: '日志',
  logWaiting: '等待操作…',

  // ── SegmentRangeSlider ───────────────────────────────────────────
  segRangeLabel: '分片范围',

  // ── SegmentGrid ──────────────────────────────────────────────────
  segStatusTitle: '分片状态',
  legendFailed: '失败',
  legendDone: '完成',
  legendScaleHint: (n: number) => `（每点代表 ${n} 片）`,

  // ── Downloader messages (sourced from zh-messages.ts) ───────────
  dlFetchingPlaylist: ZH_DL.fetchingPlaylist,
  dlNoStreamsInMaster: ZH_DL.noStreamsInMaster,
  dlFetchingStream: ZH_DL.fetchingStream,
  dlNoSegmentsInMedia: ZH_DL.noSegmentsInMedia,
  dlFetchingInitSegment: ZH_DL.fetchingInitSegment,
  dlSegmentInfo: ZH_DL.segmentInfo,
  dlRestoredFromCache: ZH_DL.restoredFromCache,
  dlSegmentFailed: ZH_DL.segmentFailed,
  dlSomeSegmentsFailed: ZH_DL.someSegmentsFailed,
  dlNoFailedSegments: ZH_DL.noFailedSegments,
  dlRetryingFailed: ZH_DL.retryingFailed,
  dlSegmentRetryFailed: ZH_DL.segmentRetryFailed,
  dlStillFailed: ZH_DL.stillFailed,
  dlRetryComplete: ZH_DL.retryComplete,
  dlMerging: ZH_DL.merging,
  dlNoOkSegments: ZH_DL.noOkSegments,
  dlSavingPartial: ZH_DL.savingPartial,
  dlSavedPartial: ZH_DL.savedPartial,
  dlConvertingMp4: ZH_DL.convertingMp4,
  dlMp4ConvertDone: ZH_DL.mp4ConvertDone,
  dlMp4ConvertFailed: ZH_DL.mp4ConvertFailed,
  dlPrepareSave: ZH_DL.prepareSave,
  dlDownloadComplete: ZH_DL.downloadComplete,
  dlNetworkError: ZH_DL.networkError,
  dlHttp403: ZH_DL.http403,
  dlHttp404: ZH_DL.http404,
  dlHttp429: ZH_DL.http429,
  dlHttpServer: ZH_DL.httpServer,
  dlHttpGeneric: ZH_DL.httpGeneric,
  dlAes128MissingKey: ZH_DL.aes128MissingKey,
  dlCircuitOpen: ZH_DL.circuitOpen,

  // ── LiveRecorder messages (sourced from zh-messages.ts) ─────────
  lrStartRecording: ZH_LR.startRecording,
  lrPlaylistFailed: ZH_LR.playlistFailed,
  lrFetchFailed: ZH_LR.fetchFailed,
  lrStreamEnded: ZH_LR.streamEnded,
  lrSegmentFailed: ZH_LR.segmentFailed,
  lrMergingRecording: ZH_LR.mergingRecording,
  lrRecordingDone: ZH_LR.recordingDone,
  lrAes128MissingKey: ZH_LR.aes128MissingKey,
  lrKeyFetchFailed: ZH_LR.keyFetchFailed,
  lrTooManyErrors: ZH_LR.tooManyErrors,

  // ── App messages ─────────────────────────────────────────────────
  appNoUrl: '没有 M3U8 地址',
  appPreParsing: '正在预解析播放列表…',
  appPreParseFailed: (msg: string) => `预解析失败：${msg}`,
  appMasterDetected: (count: number, opts: string) => `检测到 Master Playlist，${count} 个清晰度：${opts}`,
  appLiveDetected: (dur: number) => `直播流，目标分片时长 ${dur}s`,
  appSegmentsFound: (count: number, dur: string) => `共 ${count} 个分片，时长约 ${dur}`,
  appPartialFailed: (count: number) => `${count} 个分片失败，可重试或保存已完成片段`,
  appDownloadAborted: '下载已中止',
  appDownloadFailed: (msg: string) => `下载失败：${msg}`,
  appRetryAborted: '重试已中止',
  appRetryFailed: (msg: string) => `重试失败：${msg}`,
  appSaveFailed: (msg: string) => `保存失败：${msg}`,
  appSubtitleDownloading: (name: string) => `正在下载字幕：${name}…`,
  appSubtitleDone: (name: string) => `字幕 ${name} 下载完成`,
  appSubtitleFailed: (name: string, msg: string) => `字幕 ${name} 下载失败：${msg}`,
} as const;

const en = {
  // ── Popup Tabs ──────────────────────────────────────────────────
  tabStreams: 'Streams',
  tabQueue: 'Queue',
  tabHistory: 'History',
  tabSettings: 'Settings',

  // ── Popup – Stream List ─────────────────────────────────────────
  streamEmpty: 'No streams detected',
  streamEmptyHint: 'Streams will appear here when you play a video',
  clearAll: 'Clear',
  selectAll: 'Select All',
  cancelSelectAll: 'Deselect',
  preview: 'Preview',
  stopPreview: 'Stop',
  directDownload: 'Download',
  addToQueue: 'Queue',
  removeStream: 'Remove',
  selectStream: 'Select',
  deselectStream: 'Deselect',
  selected: 'Selected',
  streams: '',
  batchQueue: 'Queue Selected',
  manualUrl: 'Paste M3U8 / MPD URL…',
  manualUrlInvalid: 'Enter a valid M3U8 or MPD URL (must start with http/https and contain m3u8/mpd keywords)',

  // ── Queue Tab ───────────────────────────────────────────────────
  queueEmpty: 'Queue is empty',
  queueEmptyHint: 'Click "Queue" on a detected stream to add it',
  tasks: 'task',
  clearDone: 'Clear Done',
  statusPending: 'Pending',
  statusDownloading: 'Downloading',
  statusDone: 'Done',
  statusError: 'Error',

  // ── History Tab ─────────────────────────────────────────────────
  historyEmpty: 'No download history',
  records: 'record',
  exportHistory: 'Export',
  clearHistory: 'Clear All',
  segs: 'segs',

  // ── Settings Tab ────────────────────────────────────────────────
  settingsTitle: 'Settings',
  sectionLanguage: 'Language',
  langZh: '中文',
  langEn: 'English',
  sectionDownload: 'Download',
  concurrency: 'Concurrency',
  concurrencyHint: 'Number of parallel segment downloads',
  retries: 'Retries',
  retriesHint: 'Retry attempts on segment failure',
  convertMp4: 'Convert to MP4',
  convertMp4Hint: 'Remux TS streams to MP4 after download',
  sectionBehavior: 'Behavior',
  autoEnqueue: 'Auto-queue on click',
  autoEnqueueHint: 'Add to queue without opening the download page',
  sectionAbout: 'About',
  version: 'Version',
  resetDefaults: 'Reset Defaults',
  viewSource: 'Source Code',

  // ── Download Page ───────────────────────────────────────────────
  noUrl: '(No URL provided)',
  streamUrl: 'Stream URL',
  liveLabel: 'LIVE',
  settingsLabel: 'Settings',
  filenameLabel: 'Filename',
  concurrencyLabel: 'Concurrency',
  formatLabel: 'Format',
  formatTs: 'Original',
  formatMp4: 'Compatible',
  qualityLabel: 'Quality',
  bestTag: 'BEST',
  subtitleTracksLabel: 'Subtitles',
  audioTracksLabel: 'Audio',
  defaultAudio: 'Default',
  resumePrompt: 'Unfinished download found. Continue?',
  resumeDone: (done: number, total: number) => `${done}/${total} segments done`,
  continueDownload: 'Continue',
  freshDownload: 'Start Fresh',
  timeAgoSec: (s: number) => `${s}s ago`,
  timeAgoMin: (m: number) => `${m}m ago`,
  timeAgoHour: (h: number) => `${h}h ago`,
  timeAgoDay: (d: number) => `${d}d ago`,

  // ── ActionButtons ────────────────────────────────────────────────
  btnStartDownload: 'Start Download',
  btnStartRec: 'Start Recording',
  btnAbort: 'Abort',
  btnStopRec: 'Stop Recording',
  btnPause: 'Pause',
  btnResume: 'Resume',
  btnDone: 'Download Done',
  btnRetry: 'Retry',
  btnReset: 'Start Over',
  btnRetryFailed: (n: number) => `Retry Failed (${n})`,
  btnSaveComplete: (n: number) => `Save Completed (${n})`,
  btnSavePartial: (n: number) => `Save Done (${n})`,
  btnSavePartialTitle: (n: number) => `Save ${n} completed segments (no interruption)`,

  // ── Progress phases ──────────────────────────────────────────────
  phasePrefetching: 'Parsing…',
  phaseDownloading: 'Downloading',
  phasePaused: 'Paused',
  phaseMerging: 'Merging…',
  phasePartial: 'Partial Failure',
  phaseRecording: 'Recording',
  phaseStopping: 'Saving…',
  phaseDone: 'Done!',
  phaseError: 'Error',
  phaseAborted: 'Aborted',

  // ── LogTerminal ──────────────────────────────────────────────────
  logTitle: 'Log',
  logWaiting: 'Waiting…',

  // ── SegmentRangeSlider ───────────────────────────────────────────
  segRangeLabel: 'Segment Range',

  // ── SegmentGrid ──────────────────────────────────────────────────
  segStatusTitle: 'Segment Status',
  legendFailed: 'Failed',
  legendDone: 'Done',
  legendScaleHint: (n: number) => `(each dot = ${n} segs)`,

  // ── Downloader messages ──────────────────────────────────────────
  dlFetchingPlaylist: 'Fetching playlist…',
  dlNoStreamsInMaster: 'No streams found in master playlist',
  dlFetchingStream: (label: string) => `Fetching stream (${label})…`,
  dlNoSegmentsInMedia: 'No segments found in media playlist',
  dlFetchingInitSegment: 'Fetching init segment…',
  dlSegmentInfo: (total: number, fmt: string, dur: string) => `${total} segments (${fmt}), ~${dur}, starting download…`,
  dlRestoredFromCache: (count: number) => `Restored ${count} segments from cache, downloading remaining…`,
  dlSegmentFailed: (index: number) => `Segment ${index} download failed`,
  dlSomeSegmentsFailed: (count: number) => `${count} segments failed — click "Retry Failed" to try again`,
  dlNoFailedSegments: 'No failed segments',
  dlRetryingFailed: (count: number) => `Retrying ${count} failed segments…`,
  dlSegmentRetryFailed: (index: number) => `Segment ${index} retry failed`,
  dlStillFailed: (count: number) => `${count} segments still failing`,
  dlRetryComplete: 'Retry complete, merging…',
  dlMerging: 'Merging segments…',
  dlNoOkSegments: 'No completed segments to save',
  dlSavingPartial: (count: number) => `Saving ${count} completed segments…`,
  dlSavedPartial: (count: number, mb: string) => `Saved ${count} segments (${mb} MB)`,
  dlConvertingMp4: 'Converting to MP4…',
  dlMp4ConvertDone: 'MP4 conversion complete',
  dlMp4ConvertFailed: (msg: string) => `MP4 conversion failed (${msg}), saving as .ts`,
  dlPrepareSave: 'Preparing file for download…',
  dlDownloadComplete: (segs: number, mb: string) => `Done! ${segs} segments, ${mb} MB`,
  dlNetworkError: (url: string) => `Network error — check your connection (${url})`,
  dlHttp403: (url: string) => `403 Forbidden — stream may require login or Referer; try refreshing the page (${url})`,
  dlHttp404: (url: string) => `404 Not Found — link expired or segments deleted (${url})`,
  dlHttp429: (url: string) => `429 Too Many Requests — try reducing concurrency (${url})`,
  dlHttpServer: (status: number, url: string) => `${status} Server Error — try again later (${url})`,
  dlHttpGeneric: (status: number, url: string) => `HTTP ${status} (${url})`,
  dlAes128MissingKey: 'AES-128 encrypted but key URI is missing',
  dlCircuitOpen: (n: number) => `${n} consecutive segment failures — aborting to prevent wasted retries`,

  // ── LiveRecorder messages ────────────────────────────────────────
  lrStartRecording: 'Starting live stream recording…',
  lrPlaylistFailed: (status: number) => `Playlist request failed: HTTP ${status}, retrying in 3s`,
  lrFetchFailed: (msg: string) => `Failed to fetch playlist: ${msg}, retrying in 3s`,
  lrStreamEnded: 'Live stream ended',
  lrSegmentFailed: (err: string, url: string) => `Segment download failed (${err}), skipped: ${url}`,
  lrMergingRecording: 'Merging recording…',
  lrRecordingDone: (count: number, mb: string) => `Recording done! ${count} segments, ${mb} MB`,
  lrAes128MissingKey: 'AES-128 encrypted but key URI is missing',
  lrKeyFetchFailed: (status: number) => `Key request failed: HTTP ${status}`,
  lrTooManyErrors: (n: number) => `${n} consecutive fetch failures — stream unreachable, stopping recording`,

  // ── App messages ─────────────────────────────────────────────────
  appNoUrl: 'No M3U8 URL provided',
  appPreParsing: 'Pre-parsing playlist…',
  appPreParseFailed: (msg: string) => `Pre-parse failed: ${msg}`,
  appMasterDetected: (count: number, opts: string) => `Master playlist detected, ${count} quality options: ${opts}`,
  appLiveDetected: (dur: number) => `Live stream, target segment duration: ${dur}s`,
  appSegmentsFound: (count: number, dur: string) => `${count} segments found, duration ~${dur}`,
  appPartialFailed: (count: number) => `${count} segments failed — retry or save completed`,
  appDownloadAborted: 'Download aborted',
  appDownloadFailed: (msg: string) => `Download failed: ${msg}`,
  appRetryAborted: 'Retry aborted',
  appRetryFailed: (msg: string) => `Retry failed: ${msg}`,
  appSaveFailed: (msg: string) => `Save failed: ${msg}`,
  appSubtitleDownloading: (name: string) => `Downloading subtitle: ${name}…`,
  appSubtitleDone: (name: string) => `Subtitle ${name} downloaded`,
  appSubtitleFailed: (name: string, msg: string) => `Subtitle ${name} failed: ${msg}`,
} satisfies typeof zh;

export type Lang = 'zh' | 'en';
export type I18nKey = keyof typeof zh;

class I18nStore {
  lang = $state<Lang>('zh');

  /** Return a translated string. Parameterised keys return their function result. */
  t<K extends I18nKey>(key: K, ...args: Parameters<typeof zh[K] extends (...a: any[]) => any ? typeof zh[K] : () => string>): string {
    const dict: typeof zh = this.lang === 'zh' ? zh : (en as unknown as typeof zh);
    const val = dict[key];
    if (typeof val === 'function') {
      // @ts-ignore – overloaded key types
      return (val as (...a: unknown[]) => string)(...args);
    }
    return val as string;
  }

  /** Shorthand: get a plain string key (no args). */
  s(key: Exclude<I18nKey, { [K in I18nKey]: typeof zh[K] extends (...a: any[]) => any ? K : never }[I18nKey]>): string {
    return this.t(key as I18nKey);
  }
}

export const i18n = new I18nStore();
