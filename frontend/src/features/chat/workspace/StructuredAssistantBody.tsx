import { CodeSnippetCard } from '../../../features/chat/CodeSnippetCard'
import { lineLabel, splitFilePath } from './chatHelpers'
import { type StructuredAnswer } from './chatTypes'

// ─── Structured answer renderer ───────────────────────────────────────────────

export function StructuredAssistantBody({ content, structured }: { content: string; structured: StructuredAnswer }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--kv-ink-rgb) / 0.45)', marginBottom: 6 }}>
          {structured.title ?? 'Answer'}
        </p>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, lineHeight: 1.6, color: 'var(--kv-ink)', whiteSpace: 'pre-wrap' }}>
          {structured.summary || content}
        </p>
      </div>

      {Array.isArray(structured.sections) && structured.sections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {structured.sections.slice(0, 6).map((section, i) => (
            <div key={`${section.heading}-${i}`} style={{ borderRadius: 14, border: '1px solid var(--kv-line)', background: 'var(--kv-mist-2)', padding: '12px 14px' }}>
              <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: 'rgb(var(--kv-ink-rgb) / 0.55)', textTransform: 'uppercase', marginBottom: 6 }}>{section.heading}</p>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, listStyleType: 'disc', paddingInlineStart: 18 }}>
                {section.bullets.slice(0, 5).map((bullet, bi) => (
                  <li key={bi} style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.5, color: 'var(--kv-ink-2)' }}>{bullet}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(structured.code_references) && structured.code_references.length > 0 && (
        <div>
          <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgb(var(--kv-ink-rgb) / 0.45)', marginBottom: 8 }}>Code References</p>
          <div className="db-code-ref-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {structured.code_references.slice(0, 6).map((ref, i) => (
              <div key={`${ref.file_path}-${i}`} style={{ borderRadius: 12, border: '1px solid var(--kv-line)', background: 'var(--kv-mist-2)', padding: '10px 12px' }}>
                <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, fontWeight: 600, color: 'var(--kv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{splitFilePath(ref.file_path).fileName}</p>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgb(var(--kv-ink-rgb) / 0.5)', border: '1px solid var(--kv-line)', borderRadius: 9999, padding: '2px 8px' }}>{lineLabel(ref.start_line, ref.end_line)}</span>
                  {ref.pr_number && <span style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgb(var(--kv-ink-rgb) / 0.5)', border: '1px solid var(--kv-line)', borderRadius: 9999, padding: '2px 8px' }}>PR #{ref.pr_number}</span>}
                </div>
                {ref.note && <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: 'var(--kv-ink-2)', marginTop: 6 }}>{ref.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(structured.code_snippets) && structured.code_snippets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgb(var(--kv-ink-rgb) / 0.45)' }}>
            Code Preview
          </p>
          {structured.code_snippets.slice(0, 4).map((snippet, i) => (
            <CodeSnippetCard key={`${snippet.title || 'snippet'}-${i}`} snippet={snippet} index={i} />
          ))}
        </div>
      )}

      {Array.isArray(structured.timeline_highlights) && structured.timeline_highlights.length > 0 && (
        <div>
          <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgb(var(--kv-ink-rgb) / 0.45)', marginBottom: 8 }}>Evolution Highlights</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {structured.timeline_highlights.slice(0, 5).map((item, i) => (
              <p key={`${item.label}-${i}`} style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.5, color: 'var(--kv-ink-2)' }}>
                <span style={{ fontWeight: 600, color: 'var(--kv-ink)' }}>{item.label}:</span> {item.detail}
              </p>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(structured.limitations) && structured.limitations.length > 0 && (
        <div style={{ borderRadius: 14, border: '1px solid var(--kv-line)', background: 'var(--kv-mist-2)', padding: '12px 14px' }}>
          <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgb(var(--kv-ink-rgb) / 0.45)', marginBottom: 6 }}>Limits</p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, listStyleType: 'disc', paddingInlineStart: 18 }}>
            {structured.limitations.slice(0, 4).map((item, i) => (
              <li key={i} style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'var(--kv-ink-2)' }}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
