/** Typed message-type constants shared across background, content scripts, and UI pages. */
export const MSG = {
  M3U8_DETECTED: 'M3U8_DETECTED',
  GET_STREAMS: 'GET_STREAMS',
  REMOVE_STREAM: 'REMOVE_STREAM',
  CLEAR_STREAMS: 'CLEAR_STREAMS',
  ENQUEUE: 'ENQUEUE',
  QUEUE_ITEM_DONE: 'QUEUE_ITEM_DONE',
  QUEUE_PROGRESS: 'QUEUE_PROGRESS',
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];
