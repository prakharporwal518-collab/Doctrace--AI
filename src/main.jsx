import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('DocTrace: #root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary title="DocTrace AI failed to load. Please refresh the page.">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
