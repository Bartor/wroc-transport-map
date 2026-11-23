// Sets the component library up for this page; imported before anything that
// prints a number.
import { configure } from '@bartor-net/ui-kit'
import { pl } from '@bartor-net/ui-kit/pl'

configure({
  locale: 'pl-PL',
  strings: {
    ...pl,
    errorHint: 'Mapa działa dalej — wybierz inny punkt albo zamknij panel.',
  },
})
