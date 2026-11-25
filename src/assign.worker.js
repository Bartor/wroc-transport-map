// Runs the closure model off the page's thread.
//
//   in:  { type: 'load', json } | { type: 'run', id, change }
//   out: { type: 'ready', segments, meta, before }   the streets, to draw
//        { type: 'prep', part }                getting ready, part 0..1
//        { type: 'step', id, part }            part 0..1
//        { type: 'done', id, before, after, summary }
//        { type: 'error', id, message }
//
// A change is plain data: { closed: [k], oneWay: [[k, 1|-1]],
// capacity: [[k, factor]], reduce }.
import { load, run, undisturbed } from './assign'

let model = null

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'load') {
      model = load(data.json)
      self.postMessage({ type: 'ready', segments: model.segments, meta: model.meta, before: model.base })
      // while the reader picks a street
      undisturbed(model, (part) => self.postMessage({ type: 'prep', part }))
    } else if (data.type === 'run') {
      const { id, change } = data
      const out = run(model, change, (part) => self.postMessage({ type: 'step', id, part }))
      self.postMessage({ type: 'done', id, ...out }, [out.after.buffer])
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: e.message })
  }
}
