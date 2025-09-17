"use client";

import { useMemo } from 'react';

type IssueDetailsFormProps = {
  value: string;
  minCharacters: number;
  maxCharacters: number;
  loading?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export default function IssueDetailsForm({
  value,
  minCharacters,
  maxCharacters,
  loading = false,
  error,
  onChange,
  onSubmit,
}: IssueDetailsFormProps) {
  const trimmed = value.trim();
  const charactersUsed = value.length;
  const isBelowMinimum = trimmed.length > 0 && trimmed.length < minCharacters;
  const helperText = useMemo(() => {
    if (!trimmed.length) {
      return `Share as much detail as you can about the problem you would like your MP to address. Minimum ${minCharacters} characters.`;
    }
    if (isBelowMinimum) {
      return `Keep going — add at least ${minCharacters - trimmed.length} more characters so we have enough context.`;
    }
    return 'When you are ready, we will refine your words into a structured summary for the research step.';
  }, [trimmed.length, minCharacters, isBelowMinimum]);

  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading) onSubmit();
      }}
    >
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="issue-details" className="label">
          Describe your issue
        </label>
        <textarea
          id="issue-details"
          name="issue-details"
          className="input"
          style={{ minHeight: 200, resize: 'vertical' }}
          placeholder="Explain what has happened, why it matters, and what outcome you would like to see."
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, maxCharacters))}
          maxLength={maxCharacters}
          disabled={loading}
          aria-describedby="issue-details-helper"
        />
        <div className="field-helper" id="issue-details-helper">
          <p style={{ margin: '8px 0 0 0', color: isBelowMinimum ? '#b91c1c' : '#4b5563' }}>{helperText}</p>
        </div>
      </div>

      <div className="field" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="label" style={{ fontSize: 14, color: '#6b7280' }}>
          {charactersUsed.toLocaleString()} / {maxCharacters.toLocaleString()} characters
        </span>
        <button
          type="submit"
          className="btn-primary"
          disabled={loading || trimmed.length < minCharacters}
          aria-busy={loading}
        >
          {loading ? 'Refining…' : 'Refine my issue'}
        </button>
      </div>

      {error && (
        <div className="status" aria-live="assertive" style={{ gridColumn: '1 / -1' }}>
          <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>
        </div>
      )}
    </form>
  );
}
