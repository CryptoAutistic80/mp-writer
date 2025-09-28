import { useEffect, useMemo, useState } from 'react';

type ProgressStep = {
  message: string;
  delayMs: number;
  progress: number;
};

const PROGRESS_STEPS: ProgressStep[] = [
  {
    message: 'Submitting your deep research request…',
    delayMs: 0,
    progress: 0.12,
  },
  {
    message: 'Searching recent parliamentary and policy sources…',
    delayMs: 12000,
    progress: 0.36,
  },
  {
    message: 'Reviewing credibility and extracting key findings…',
    delayMs: 20000,
    progress: 0.58,
  },
  {
    message: 'Drafting the letter with evidence-backed arguments…',
    delayMs: 22000,
    progress: 0.78,
  },
  {
    message: 'Formatting citations and polishing the copy…',
    delayMs: 20000,
    progress: 0.92,
  },
];

const FALLBACK_MESSAGE = 'Starting deep research…';

interface DeepResearchProgressProps {
  active: boolean;
  messageOverride?: string | null;
}

export default function DeepResearchProgress({ active, messageOverride }: DeepResearchProgressProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    if (!active) {
      setHistory([]);
      setCurrentStep(0);
      setProgress(0);
      return;
    }

    setHistory([]);
    setCurrentStep(0);
    setProgress(PROGRESS_STEPS[0]?.progress ?? 0.1);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let cumulativeDelay = 0;

    PROGRESS_STEPS.forEach((step, index) => {
      cumulativeDelay += index === 0 ? 0 : step.delayMs;
      const timer = setTimeout(() => {
        setCurrentStep(index);
        setProgress(step.progress);
      }, cumulativeDelay);
      timers.push(timer);
    });

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [active]);

  const fallbackMessage = useMemo(() => {
    return PROGRESS_STEPS[currentStep]?.message ?? FALLBACK_MESSAGE;
  }, [currentStep]);

  const displayMessage = messageOverride?.trim() ? messageOverride : fallbackMessage;

  useEffect(() => {
    if (!active) {
      setHistory([]);
      return;
    }
    if (!displayMessage.trim()) return;
    setHistory((prev) => {
      if (prev[prev.length - 1] === displayMessage) return prev;
      return [...prev, displayMessage];
    });
  }, [active, displayMessage]);

  const isTerminalMessage = useMemo(() => {
    const message = (messageOverride || '').toLowerCase();
    if (!message.trim()) return false;
    const patterns: RegExp[] = [
      /completed/,
      new RegExp('draft\\s+ready'),
      new RegExp('\\bready\\b'),
      /finished/,
      /failed/,
      /unable/,
    ];
    return patterns.some((pattern) => pattern.test(message));
  }, [messageOverride]);

  useEffect(() => {
    if (!active || isTerminalMessage) {
      setHistory([]);
    }
  }, [active, isTerminalMessage]);

  if (!active || isTerminalMessage) {
    return null;
  }

  const previousMessages = history.slice(0, -1);
  const currentMessage = history[history.length - 1] ?? displayMessage;
  const percentage = Math.min(100, Math.max(5, Math.round(progress * 100)));

  return (
    <div className="deep-progress" aria-live="polite">
      {previousMessages.length > 0 && (
        <ol className="deep-progress-activity">
          {previousMessages.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ol>
      )}
      <p className="deep-progress-message">{currentMessage}</p>
      <div
        className="deep-progress-meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-label="Deep research progress"
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <p className="deep-progress-hint">Deep research can take a minute or two—feel free to keep this tab open.</p>
    </div>
  );
}
