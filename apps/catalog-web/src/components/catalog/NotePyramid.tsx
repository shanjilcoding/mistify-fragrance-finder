type NotePyramidProps = {
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
}

type NoteLayerProps = {
  label: string
  notes: string[]
}

function NoteLayer({ label, notes }: NoteLayerProps) {
  if (!notes.length) {
    return null
  }

  return (
    <div className="catalog-note-layer">
      <p className="catalog-note-layer__label">{label}</p>
      <div className="catalog-note-chips">
        {notes.map((note) => (
          <span key={`${label}-${note}`}>{note}</span>
        ))}
      </div>
    </div>
  )
}

function NotePyramid({
  topNotes,
  middleNotes,
  baseNotes,
  allNotes,
}: NotePyramidProps) {
  const hasLayers = topNotes.length || middleNotes.length || baseNotes.length

  if (!hasLayers && !allNotes.length) {
    return <p className="catalog-status">Notes are not available for this fragrance yet.</p>
  }

  if (!hasLayers) {
    return (
      <div className="catalog-note-pyramid">
        <NoteLayer label="Notes" notes={allNotes} />
      </div>
    )
  }

  return (
    <div className="catalog-note-pyramid">
      <NoteLayer label="Top Notes" notes={topNotes} />
      <NoteLayer label="Middle Notes" notes={middleNotes} />
      <NoteLayer label="Base Notes" notes={baseNotes} />
    </div>
  )
}

export default NotePyramid
