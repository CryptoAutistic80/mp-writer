'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';

type InfoTooltipProps = {
  content: ReactNode;
  label?: string;
  trigger?: ReactNode;
  className?: string;
  placement?: 'top' | 'bottom' | 'right' | 'left';
  inlineHint?: boolean;
};

function isPointerEventTouch(event: PointerEvent) {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

export function InfoTooltip({
  content,
  label = 'More information',
  trigger,
  className,
  placement = 'top',
  inlineHint = true,
}: InfoTooltipProps) {
  const generatedId = useId();
  const tooltipId = useMemo(() => `info-tooltip-${generatedId}`, [generatedId]);
  const [hoverVisible, setHoverVisible] = useState(false);
  const [touchVisible, setTouchVisible] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!touchVisible) return;

    const handlePointerDown = (event: PointerEvent | globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!containerRef.current || (target && containerRef.current.contains(target))) {
        return;
      }
      setTouchVisible(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [touchVisible]);

  const visible = hoverVisible || touchVisible;

  const resolvedTrigger = trigger ?? (
    <span className="info-tooltip__icon" aria-hidden="true">i</span>
  );

  return (
    <span
      ref={containerRef}
      className={`info-tooltip${className ? ` ${className}` : ''}`}
      data-placement={placement}
      data-visible={visible ? 'true' : 'false'}
    >
      <button
        type="button"
        className="info-tooltip__trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        onMouseEnter={() => setHoverVisible(true)}
        onMouseLeave={() => setHoverVisible(false)}
        onFocus={() => setHoverVisible(true)}
        onBlur={() => setHoverVisible(false)}
        onPointerDown={(event) => {
          if (!isPointerEventTouch(event)) return;
          event.preventDefault();
          const next = !touchVisible;
          setTouchVisible(next);
          setHoverVisible(false);
          if (next) {
            if (closeTimerRef.current !== null && typeof window !== 'undefined') {
              window.clearTimeout(closeTimerRef.current);
            }
            if (typeof window !== 'undefined') {
              closeTimerRef.current = window.setTimeout(() => {
                setTouchVisible(false);
                closeTimerRef.current = null;
              }, 6000);
            }
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setHoverVisible(false);
            setTouchVisible(false);
          }
        }}
      >
        {resolvedTrigger}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`info-tooltip__bubble info-tooltip__bubble--${placement}`}
        data-state={visible ? 'visible' : 'hidden'}
      >
        {content}
      </span>
      {inlineHint && (
        <span className="info-tooltip__inline" aria-hidden="true">
          {content}
        </span>
      )}
    </span>
  );
}

export default InfoTooltip;
