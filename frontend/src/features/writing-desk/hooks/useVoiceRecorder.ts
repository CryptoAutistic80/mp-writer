"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

type RecorderStatus = 'idle' | 'recording' | 'transcribing';

interface VoiceRecorderOptions {
  getCurrentValue: () => string;
  onUpdate: (value: string, meta: { isFinal: boolean }) => void;
}

interface ParsedEvent {
  event: string;
  data: string;
}

const parseSseEvent = (raw: string): ParsedEvent | null => {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return { event, data: dataLines.join('\n') };
};

const extractText = (payload: unknown): string => {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    if (typeof (payload as Record<string, unknown>).text === 'string') {
      return (payload as Record<string, unknown>).text as string;
    }
    if (typeof (payload as Record<string, unknown>).delta === 'string') {
      return (payload as Record<string, unknown>).delta as string;
    }
  }
  return '';
};

const parseEventPayload = (data: string): unknown => {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

export interface VoiceRecorderControls {
  status: RecorderStatus;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

export const useVoiceRecorder = (options: VoiceRecorderOptions): VoiceRecorderControls => {
  const optionsRef = useRef(options);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const baseValueRef = useRef('');
  const appendedRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const setSafeStatus = useCallback((value: RecorderStatus) => {
    if (!isMountedRef.current) return;
    setStatus(value);
  }, []);

  const setSafeError = useCallback((value: string | null) => {
    if (!isMountedRef.current) return;
    setError(value);
  }, []);

  const cleanupMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore track stop errors
        }
      });
      mediaStreamRef.current = null;
    }
  }, []);

  const resetRecorder = useCallback(() => {
    if (mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch {
        // ignore recorder stop errors
      }
    }
    cleanupMediaStream();
    chunksRef.current = [];
    appendedRef.current = '';
  }, [cleanupMediaStream]);

  const cancelTranscription = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelTranscription();
    resetRecorder();
    setSafeStatus('idle');
  }, [cancelTranscription, resetRecorder, setSafeStatus]);

  useEffect(() => () => {
    isMountedRef.current = false;
    cancel();
  }, [cancel]);

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'inactive') {
      resetRecorder();
      return;
    }
    try {
      recorder.stop();
    } catch {
      resetRecorder();
    }
  }, [resetRecorder]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        setSafeStatus('idle');
        return;
      }

      setSafeError(null);
      setSafeStatus('transcribing');

      const formData = new FormData();
      formData.append('audio', blob, 'voice-input.webm');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch('/api/ai/transcriptions/stream', {
          method: 'POST',
          body: formData,
          credentials: 'include',
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const messageText = await response.text().catch(() => '');
          let parsedMessage = messageText.trim();
          if (parsedMessage.startsWith('{')) {
            try {
              const json = JSON.parse(parsedMessage);
              parsedMessage =
                typeof json?.message === 'string'
                  ? json.message
                  : typeof json?.error === 'string'
                    ? json.error
                    : parsedMessage;
            } catch {
              // ignore JSON parse error, keep raw text
            }
          }
          setSafeError(parsedMessage || 'We could not transcribe your recording. Please try again.');
          setSafeStatus('idle');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let encounteredError = false;

        const processBuffer = (flush = false) => {
          let delimiterIndex = buffer.indexOf('\n\n');
          while (delimiterIndex !== -1) {
            const rawEvent = buffer.slice(0, delimiterIndex);
            buffer = buffer.slice(delimiterIndex + 2);
            const parsed = parseSseEvent(rawEvent);
            if (parsed) {
              const payload = parseEventPayload(parsed.data);
              if (parsed.event === 'delta') {
                const deltaText = extractText(payload);
                if (deltaText) {
                  appendedRef.current += deltaText;
                  optionsRef.current.onUpdate(
                    `${baseValueRef.current}${appendedRef.current}`,
                    { isFinal: false },
                  );
                }
              } else if (parsed.event === 'done') {
                const finalText = extractText(payload);
                if (finalText) {
                  appendedRef.current = finalText;
                }
                optionsRef.current.onUpdate(
                  `${baseValueRef.current}${appendedRef.current}`,
                  { isFinal: true },
                );
              } else if (parsed.event === 'error') {
                encounteredError = true;
                const message =
                  typeof payload === 'string'
                    ? payload
                    : payload && typeof payload === 'object' && typeof (payload as any).message === 'string'
                      ? (payload as any).message
                      : 'We could not transcribe your recording. Please try again.';
                setSafeError(message);
              }
            }
            delimiterIndex = buffer.indexOf('\n\n');
          }

          if (flush && buffer.trim().length > 0) {
            const parsed = parseSseEvent(buffer);
            buffer = '';
            if (parsed) {
              const payload = parseEventPayload(parsed.data);
              if (parsed.event === 'done') {
                const finalText = extractText(payload);
                if (finalText) {
                  appendedRef.current = finalText;
                }
                optionsRef.current.onUpdate(
                  `${baseValueRef.current}${appendedRef.current}`,
                  { isFinal: true },
                );
              }
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }
        buffer += decoder.decode();
        processBuffer(true);

        if (!encounteredError && appendedRef.current) {
          optionsRef.current.onUpdate(
            `${baseValueRef.current}${appendedRef.current}`,
            { isFinal: true },
          );
        }

        reader.releaseLock();
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return;
        }
        setSafeError('We could not transcribe your recording. Please try again.');
      } finally {
        abortControllerRef.current = null;
        setSafeStatus('idle');
      }
    },
    [setSafeError, setSafeStatus],
  );

  const start = useCallback(async () => {
    if (status !== 'idle') {
      return;
    }

    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      setSafeError('Audio recording is not supported in this browser.');
      return;
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      setSafeError('Microphone access is not available on this device.');
      return;
    }

    setSafeError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = typeof MediaRecorder !== 'undefined'
        && typeof MediaRecorder.isTypeSupported === 'function'
        && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined;

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      baseValueRef.current = optionsRef.current.getCurrentValue();
      appendedRef.current = '';

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        cleanupMediaStream();
        const blob = new Blob(chunksRef.current, { type: mimeType ?? 'audio/webm' });
        void transcribe(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setSafeStatus('recording');
    } catch (err: any) {
      cleanupMediaStream();
      const message =
        err?.name === 'NotAllowedError'
          ? 'Microphone access was denied.'
          : 'We could not start recording. Please check your microphone and try again.';
      setSafeError(message);
      setSafeStatus('idle');
    }
  }, [cleanupMediaStream, setSafeError, setSafeStatus, status, transcribe]);

  return {
    status,
    error,
    start,
    stop,
    cancel,
  };
};

