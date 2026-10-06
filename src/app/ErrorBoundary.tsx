import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Catches render errors so one broken page never blanks the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; fullPage?: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DocTrace UI error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A new deploy can leave an open tab pointing at chunk files that no longer exist.
    const stale = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message);
    return (
      <div className={this.props.fullPage ? 'grid min-h-dvh place-items-center p-6' : 'py-10'} role="alert">
        <div className="card mx-auto max-w-md p-6">
          <p className="font-semibold">{stale ? 'DocTrace was updated' : 'Something went wrong on this page'}</p>
          <p className="mt-1 text-sm break-words text-muted">{stale ? 'Reload to get the latest version.' : error.message}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="rounded-lg bg-yellow px-4 py-2 text-sm font-semibold text-navy" onClick={() => window.location.reload()}>
              Reload
            </button>
            {!stale && (
              <button type="button" className="rounded-lg border border-line-2 px-4 py-2 text-sm" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
