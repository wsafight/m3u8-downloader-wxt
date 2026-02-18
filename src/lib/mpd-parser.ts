/**
 * Minimal MPEG-DASH MPD parser.
 * Supports SegmentTemplate (with $Number$ / $Time$ / $Bandwidth$ tokens)
 * and SegmentList formats.
 * Outputs objects compatible with MediaPlaylist / MasterPlaylist.
 */

import type { MasterPlaylist, MediaPlaylist, Segment, StreamDef } from './types';

export type DashPlaylist = MasterPlaylist | MediaPlaylist;

interface AdaptationSet {
  mimeType: string;
  codecs: string;
  lang?: string;
  representations: Representation[];
}

interface Representation {
  id: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  baseUrl?: string;
  initUrl?: string;
  segmentUrls: string[];
  duration: number; // per segment in seconds
}

export class MpdParser {
  static parse(text: string, baseUrl: string): DashPlaylist {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');

    const mpdEl = doc.documentElement;
    if (mpdEl.tagName !== 'MPD') {
      throw new Error('不是合法的 MPD 文件（根元素不是 MPD）');
    }

    const mediaPresentationDuration = this.parseDuration(
      mpdEl.getAttribute('mediaPresentationDuration') ?? '',
    );
    const isLive =
      (mpdEl.getAttribute('type') ?? 'static').toLowerCase() === 'dynamic';

    const periods = Array.from(mpdEl.getElementsByTagName('Period'));
    if (periods.length === 0) throw new Error('MPD 中没有 Period');

    // Collect all video AdaptationSets across all periods
    const videoReps: Array<{ rep: Representation; adaptSet: AdaptationSet }> = [];

    for (const period of periods) {
      const periodBaseUrl = this.getBaseUrl(period, baseUrl);

      const adaptationSets = Array.from(period.getElementsByTagName('AdaptationSet'));
      for (const as of adaptationSets) {
        const mimeType =
          as.getAttribute('mimeType') ??
          as.getAttribute('contentType') ??
          '';
        const codecs = as.getAttribute('codecs') ?? '';

        // Only process video streams
        if (!mimeType.includes('video') && !codecs.includes('avc') && !codecs.includes('hvc')) {
          // Skip non-video unless it's the only AdaptationSet
          if (adaptationSets.length > 1) continue;
        }

        const adaptSet: AdaptationSet = {
          mimeType,
          codecs,
          lang: as.getAttribute('lang') ?? undefined,
          representations: [],
        };

        const representations = Array.from(as.getElementsByTagName('Representation'));
        for (const rep of representations) {
          const parsed = this.parseRepresentation(rep, as, period, periodBaseUrl, baseUrl);
          if (parsed) {
            adaptSet.representations.push(parsed);
            videoReps.push({ rep: parsed, adaptSet });
          }
        }
      }
    }

    if (videoReps.length === 0) throw new Error('MPD 中没有可用的视频流');

    // If multiple representations — return as MasterPlaylist
    if (videoReps.length > 1) {
      const streams: StreamDef[] = videoReps.map(({ rep }) => ({
        bandwidth: rep.bandwidth,
        resolution: rep.width && rep.height ? `${rep.width}x${rep.height}` : '',
        codecs: rep.codecs ?? '',
        name: rep.id,
        frameRate: 0,
        url: rep.initUrl ?? rep.segmentUrls[0] ?? '',
      }));
      streams.sort((a, b) => b.bandwidth - a.bandwidth);
      return { type: 'master', streams, mediaTracks: [] };
    }

    // Single representation — return as MediaPlaylist
    const { rep } = videoReps[0];
    const segments: Segment[] = rep.segmentUrls.map((url, i) => ({
      url,
      duration: rep.duration,
      sequence: i,
      encryption: null,
    }));

    const totalDuration =
      mediaPresentationDuration > 0
        ? mediaPresentationDuration
        : segments.length * rep.duration;

    return {
      type: 'media',
      segments,
      totalDuration,
      targetDuration: rep.duration,
      isEndList: !isLive,
      isLive,
      isFmp4: true,
      initSegment: rep.initUrl ? { url: rep.initUrl } : undefined,
      subtitleTracks: [],
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private static parseRepresentation(
    rep: Element,
    adaptSet: Element,
    period: Element,
    periodBaseUrl: string,
    docBaseUrl: string,
  ): Representation | null {
    const id = rep.getAttribute('id') ?? '';
    const bandwidth = parseInt(rep.getAttribute('bandwidth') ?? '0') || 0;
    const width = parseInt(rep.getAttribute('width') ?? '0') || undefined;
    const height = parseInt(rep.getAttribute('height') ?? '0') || undefined;
    const codecs =
      rep.getAttribute('codecs') ?? adaptSet.getAttribute('codecs') ?? undefined;

    const repBaseUrl = this.getBaseUrl(rep, periodBaseUrl);

    // ── SegmentTemplate ──────────────────────────────────────────
    const segTemplate =
      rep.getElementsByTagName('SegmentTemplate')[0] ??
      adaptSet.getElementsByTagName('SegmentTemplate')[0] ??
      period.getElementsByTagName('SegmentTemplate')[0];

    if (segTemplate) {
      return this.parseSegmentTemplate(segTemplate, {
        id,
        bandwidth,
        width,
        height,
        codecs,
        baseUrl: repBaseUrl,
      });
    }

    // ── SegmentList ──────────────────────────────────────────────
    const segList =
      rep.getElementsByTagName('SegmentList')[0] ??
      adaptSet.getElementsByTagName('SegmentList')[0];

    if (segList) {
      return this.parseSegmentList(segList, {
        id,
        bandwidth,
        width,
        height,
        codecs,
        baseUrl: repBaseUrl,
      });
    }

    // ── BaseURL single-file (no segmentation) ────────────────────
    if (repBaseUrl) {
      return {
        id,
        bandwidth,
        width,
        height,
        codecs,
        baseUrl: repBaseUrl,
        segmentUrls: [repBaseUrl],
        duration: 0,
      };
    }

    return null;
  }

  private static parseSegmentTemplate(
    tmpl: Element,
    info: { id: string; bandwidth: number; width?: number; height?: number; codecs?: string; baseUrl?: string },
  ): Representation {
    const initTmpl = tmpl.getAttribute('initialization');
    const mediaTmpl = tmpl.getAttribute('media') ?? '';
    const timescale = parseInt(tmpl.getAttribute('timescale') ?? '1') || 1;
    const duration = parseInt(tmpl.getAttribute('duration') ?? '0') || 0;
    const startNumber = parseInt(tmpl.getAttribute('startNumber') ?? '1') || 1;

    const durationSec = duration / timescale;
    const base = info.baseUrl ?? '';

    // ── SegmentTimeline ──────────────────────────────────────────
    const timeline = tmpl.getElementsByTagName('S');
    const segmentUrls: string[] = [];

    if (timeline.length > 0) {
      let currentTime = 0;
      let segNumber = startNumber;
      for (const s of Array.from(timeline)) {
        const t = s.getAttribute('t');
        if (t) currentTime = parseInt(t);
        const d = parseInt(s.getAttribute('d') ?? '0');
        const r = parseInt(s.getAttribute('r') ?? '0');
        for (let repeat = 0; repeat <= r; repeat++) {
          const url = this.fillTemplate(mediaTmpl, {
            RepresentationID: info.id,
            Bandwidth: String(info.bandwidth),
            Number: String(segNumber),
            Time: String(currentTime),
          });
          segmentUrls.push(this.resolveUrl(url, base));
          currentTime += d;
          segNumber++;
        }
      }
    } else if (duration > 0) {
      // Use Number-based template — we don't know total segments without total duration
      // Emit a placeholder; real usage needs total duration
      for (let n = startNumber; n < startNumber + 1000; n++) {
        const url = this.fillTemplate(mediaTmpl, {
          RepresentationID: info.id,
          Bandwidth: String(info.bandwidth),
          Number: String(n),
          Time: '0',
        });
        segmentUrls.push(this.resolveUrl(url, base));
      }
    }

    const initUrl = initTmpl
      ? this.resolveUrl(
          this.fillTemplate(initTmpl, {
            RepresentationID: info.id,
            Bandwidth: String(info.bandwidth),
          }),
          base,
        )
      : undefined;

    return {
      ...info,
      initUrl,
      segmentUrls,
      duration: durationSec,
    };
  }

  private static parseSegmentList(
    segList: Element,
    info: { id: string; bandwidth: number; width?: number; height?: number; codecs?: string; baseUrl?: string },
  ): Representation {
    const timescale = parseInt(segList.getAttribute('timescale') ?? '1') || 1;
    const duration = parseInt(segList.getAttribute('duration') ?? '0') || 0;
    const durationSec = duration / timescale;
    const base = info.baseUrl ?? '';

    const initEl = segList.getElementsByTagName('Initialization')[0];
    const initUrl = initEl?.getAttribute('sourceURL')
      ? this.resolveUrl(initEl.getAttribute('sourceURL')!, base)
      : undefined;

    const segmentUrls: string[] = [];
    for (const urlEl of Array.from(segList.getElementsByTagName('SegmentURL'))) {
      const media = urlEl.getAttribute('media');
      if (media) segmentUrls.push(this.resolveUrl(media, base));
    }

    return {
      ...info,
      initUrl,
      segmentUrls,
      duration: durationSec,
    };
  }

  private static fillTemplate(tmpl: string, vars: Record<string, string>): string {
    return tmpl.replace(/\$([A-Za-z]+)\$/g, (_, key) => vars[key] ?? `$${key}$`);
  }

  private static getBaseUrl(el: Element, fallback: string): string {
    const baseUrlEl = el.getElementsByTagName('BaseURL')[0];
    if (!baseUrlEl) return fallback;
    const href = baseUrlEl.textContent?.trim() ?? '';
    return href ? this.resolveUrl(href, fallback) : fallback;
  }

  private static resolveUrl(url: string, base: string): string {
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }

  /** Parse ISO 8601 duration (PT1H2M3S, PT3M, etc.) → seconds */
  private static parseDuration(str: string): number {
    if (!str) return 0;
    const m = str.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/);
    if (!m) return 0;
    const [, , , d, h, min, s] = m;
    return (
      (parseInt(d ?? '0') || 0) * 86400 +
      (parseInt(h ?? '0') || 0) * 3600 +
      (parseInt(min ?? '0') || 0) * 60 +
      (parseFloat(s ?? '0') || 0)
    );
  }
}
