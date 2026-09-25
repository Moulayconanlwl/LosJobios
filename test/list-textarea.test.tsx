import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListTextarea, parseList } from '@/ui/components/ui'

/**
 * The regression guard for a bug that made the Skills box unusable: the
 * parsed array was rendered straight back as the field's text, so the comma
 * you pressed parsed away to nothing and was deleted from under the cursor.
 * "Python, Go" typed by hand came out as "PythonGo"; pasting the same string
 * worked, which is how it went unnoticed.
 *
 * Reproducing it needs the *parent* in the loop — a controlled owner that
 * stores the parsed array and feeds it back down — so the harness below does
 * exactly what the options page does.
 */

function Harness({ onList, initial = [] }: { onList?: (next: string[]) => void; initial?: string[] }) {
  const [list, setList] = useState<string[]>(initial)
  return (
    <ListTextarea
      value={list}
      separator=", "
      onChange={(next) => {
        setList(next)
        onList?.(next)
      }}
    />
  )
}

afterEach(cleanup)

describe('parseList', () => {
  it('splits on commas and newlines and drops the blanks', () => {
    expect(parseList('Python, Go\n\nRust,')).toEqual(['Python', 'Go', 'Rust'])
  })

  it('is empty for an empty string', () => {
    expect(parseList('   ')).toEqual([])
  })
})

describe('ListTextarea', () => {
  it('keeps a separator the user just typed', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(box, 'Python,')

    // The old implementation parsed this to ['Python'], rendered "Python",
    // and ate the comma.
    expect(box.value).toBe('Python,')
  })

  it('lets a second entry be typed rather than only pasted', async () => {
    const user = userEvent.setup()
    const onList = vi.fn()
    render(<Harness onList={onList} />)

    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(box, 'Python, Go')

    expect(box.value).toBe('Python, Go')
    expect(onList).toHaveBeenLastCalledWith(['Python', 'Go'])
  })

  it('reports the parsed list as it is typed, not only on blur', async () => {
    const user = userEvent.setup()
    const onList = vi.fn()
    render(<Harness onList={onList} />)

    await user.type(screen.getByRole('textbox'), 'Rust')
    expect(onList).toHaveBeenLastCalledWith(['Rust'])
  })

  it('shows a list it was given to start with', () => {
    render(<Harness initial={['Python', 'Go']} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Python, Go')
  })

  it('adopts an outside change while the field is not being edited', () => {
    const { rerender } = render(<ListTextarea value={['Python']} separator=", " onChange={() => {}} />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box.value).toBe('Python')

    // A resume parse just filled the profile in underneath.
    rerender(<ListTextarea value={['Python', 'Kubernetes']} separator=", " onChange={() => {}} />)
    expect(box.value).toBe('Python, Kubernetes')
  })

  it('does not clobber what is being typed when the owner re-renders', async () => {
    const user = userEvent.setup()
    const onList = vi.fn()
    render(<Harness onList={onList} />)

    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(box, 'Postgre')

    // The owner has re-rendered on every keystroke by now, each time with a
    // freshly parsed array. The half-typed word has to survive that.
    expect(box.value).toBe('Postgre')
  })
})
