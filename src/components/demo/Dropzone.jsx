import { useRef, useState } from 'react';
import { ACCEPT, MAX_FILE_BYTES } from '../../engine/parsers.js';
import Icon from '../Icon.jsx';

export default function Dropzone({ onFiles, busy }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const handle = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) handle(e.dataTransfer?.files);
      }}
    >
      <Icon name="upload" size={22} />
      <div>
        <p>
          <strong>Drop files here</strong> or{' '}
          <button type="button" className="linklike" onClick={() => inputRef.current?.click()} disabled={busy}>
            browse
          </button>
        </p>
        <p className="muted small">PDF (with text), DOCX, CSV, TXT · up to {MAX_FILE_BYTES / 1048576} MB each</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload documents"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = ''; // allow picking the same file again
        }}
      />
    </div>
  );
}
