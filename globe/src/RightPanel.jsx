import React, { useState } from 'react'
import aiGenerator from './utils/aiGenerator'

const ModeButton = ({ active, onClick, children }) => (
  <button className={`mode-btn ${active ? 'active' : ''}`} onClick={onClick}>
    {children}
  </button>
)

export default function RightPanel({ markers, selectedMarker, onSelectMarker, onAddNote, onDeleteMarker, mode, onModeChange }) {
  const [query, setQuery] = useState('')
  
  const [noteText, setNoteText] = useState('')
  // compute aiText reactively (avoid calling setState synchronously in an effect)
  const aiText = React.useMemo(() => {
    if (selectedMarker) {
      return aiGenerator.generate(mode, selectedMarker.placeName || `${selectedMarker.lat.toFixed(2)}, ${selectedMarker.lng.toFixed(2)}`)
    }
    return 'Click a location on the globe to add a marker and see AI content here.'
  }, [selectedMarker, mode])

  const handleAddNote = () => {
    if (!selectedMarker || !noteText.trim()) return
    onAddNote(selectedMarker.id, { text: noteText.trim(), createdAt: Date.now() })
    setNoteText('')
  }

  return (
    <div className="panel-root">
      <div className="panel-top">
        <input
          className="search"
          placeholder="Search a city or country..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && query.trim()) {
              // fire a custom event for map to handle geocoding/flyTo
              const ev = new CustomEvent('globe-search', { detail: { query: query.trim() } })
              window.dispatchEvent(ev)
            }
          }}
        />
        <div className="modes">
          <ModeButton active={mode === 'Facts'} onClick={() => onModeChange('Facts')}>Facts</ModeButton>
          <ModeButton active={mode === 'Story'} onClick={() => onModeChange('Story')}>Story</ModeButton>
          <ModeButton active={mode === 'Travel'} onClick={() => onModeChange('Travel')}>Travel</ModeButton>
          <ModeButton active={mode === 'Lore'} onClick={() => onModeChange('Lore')}>Lore</ModeButton>
        </div>
      </div>

      <div className="panel-main">
        <h3 className="panel-title">{selectedMarker ? selectedMarker.placeName || 'Selected location' : 'Explorer'}</h3>
  <div className="ai-card">{aiText}</div>

        {selectedMarker && (
          <div className="notes">
            <h4>Notes</h4>
            <div className="note-creator">
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a personal note..." />
              <button onClick={handleAddNote}>Add</button>
            </div>
            <div className="note-list">
              {(selectedMarker.notes || []).map((n, i) => (
                <div key={i} className="note-item">{n.text}</div>
              ))}
            </div>
            <div className="marker-actions">
              <button className="danger" onClick={() => onDeleteMarker(selectedMarker.id)}>Delete Marker</button>
            </div>
          </div>
        )}

        <div className="explorer-log">
          <h4>Explorer Log</h4>
          <div className="log-list">
            {markers.map((m) => (
              <div key={m.id} className={`log-item ${selectedMarker && selectedMarker.id === m.id ? 'selected' : ''}`} onClick={() => onSelectMarker(m.id)}>
                <div className="log-name">{m.placeName || `${m.lat.toFixed(2)}, ${m.lng.toFixed(2)}`}</div>
                <div className="log-meta">{new Date(m.createdAt).toLocaleString()}</div>
              </div>
            ))}
            {markers.length === 0 && <div className="log-empty">No markers yet — click the globe to explore.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
