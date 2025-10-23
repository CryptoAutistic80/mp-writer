'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  inlineHint = false,
}: InfoTooltipProps) {
  const generatedId = useId();
  const tooltipId = useMemo(() => `info-tooltip-${generatedId}`, [generatedId]);
  const [hoverVisible, setHoverVisible] = useState(false);
  const [touchVisible, setTouchVisible] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [alignment, setAlignment] = useState<'center' | 'start' | 'end'>('center');
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [resolvedPlacement, setResolvedPlacement] = useState(placement);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(hover: none), (pointer: coarse)');
    const updatePointerState = () => {
      setIsCoarsePointer(mediaQuery.matches);
    };

    updatePointerState();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updatePointerState);
      return () => {
        mediaQuery.removeEventListener('change', updatePointerState);
      };
    }

    mediaQuery.addListener(updatePointerState);
    return () => {
      mediaQuery.removeListener(updatePointerState);
    };
  }, []);

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

  const basePlacement = useMemo(() => {
    if (isCoarsePointer && (placement === 'left' || placement === 'right')) {
      return 'bottom';
    }
    return placement;
  }, [isCoarsePointer, placement]);

  useEffect(() => {
    if (!visible) {
      setAlignment('center');
      setResolvedPlacement(basePlacement);
    }
  }, [visible, basePlacement]);

  useEffect(() => {
    if (visible) {
      setResolvedPlacement((current) => (current === basePlacement ? current : basePlacement));
    }
  }, [basePlacement, visible]);

  useLayoutEffect(() => {
    if (!visible || typeof window === 'undefined') return;
    const bubble = bubbleRef.current;
    if (!bubble) return;

    const detectOverflow = () => {
      const rect = bubble.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      let next: 'center' | 'start' | 'end' = 'center';
      let nextPlacement = resolvedPlacement;

      if (resolvedPlacement === 'top' && rect.top < 12) {
        nextPlacement = 'bottom';
      } else if (resolvedPlacement === 'bottom' && rect.bottom > viewportHeight - 12) {
        nextPlacement = 'top';
      } else if (resolvedPlacement === 'left' && rect.left < 12) {
        nextPlacement = 'right';
      } else if (resolvedPlacement === 'right' && rect.right > viewportWidth - 12) {
        nextPlacement = 'left';
      }

      if (nextPlacement !== resolvedPlacement) {
        setResolvedPlacement(nextPlacement);
        return;
      }

      if (resolvedPlacement === 'left' || resolvedPlacement === 'right') {
        if (rect.top < 12) next = 'start';
        else if (rect.bottom > viewportHeight - 12) next = 'end';
      } else {
        if (rect.left < 12) next = 'start';
        else if (rect.right > viewportWidth - 12) next = 'end';
      }
      setAlignment((prev) => (prev === next ? prev : next));
    };

    const frame = window.requestAnimationFrame(detectOverflow);
    const handleResize = () => detectOverflow();
    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
  }, [visible, resolvedPlacement, basePlacement]);

  const resolvedTrigger = trigger ?? (
    <span className="info-tooltip__icon" aria-hidden="true">i</span>
  );

  return (
    <span
      ref={containerRef}
      className={`info-tooltip${className ? ` ${className}` : ''}`}
      data-placement={placement}
      data-visible={visible ? 'true' : 'false'}
      data-inline={inlineHint ? 'true' : 'false'}
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
        ref={bubbleRef}
        id={tooltipId}
        role="tooltip"
        className={`info-tooltip__bubble info-tooltip__bubble--${resolvedPlacement}`}
        data-state={visible ? 'visible' : 'hidden'}
        data-align={alignment}
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
