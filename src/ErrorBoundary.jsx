import { Component } from 'react'

/** Keeps one broken panel from blanking the whole map.
 *
 *  Without it, any exception while rendering the detail panel unmounted the
 *  entire app - the map, the sidebar, everything - leaving a dark empty page
 *  with nothing on screen to say why. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prev) {
    // a new selection gets a fresh attempt
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="details">
        <div className="dhead" style={{ borderColor: '#c1392b' }}>
          <div><h3>Nie udało się wyświetlić panelu</h3></div>
          {this.props.onClose && <button onClick={this.props.onClose}>×</button>}
        </div>
        <div className="dbody">
          <p className="warn">{String(this.state.error.message || this.state.error)}</p>
          <p className="hint">Mapa działa dalej — wybierz inny punkt albo zamknij panel.</p>
        </div>
      </div>
    )
  }
}
