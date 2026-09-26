import { Component } from 'react';

// Catches render errors so one broken widget never blanks the whole page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('DocTrace UI error:', error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-box" role="alert">
        <strong>{this.props.title || 'Something went wrong in this section.'}</strong>
        <p className="muted small">{String(this.state.error?.message || this.state.error)}</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={this.reset}>Try again</button>
      </div>
    );
  }
}
