import { useState } from 'react'
import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { resolveErrorMessage } from '@/lib/errorMessage'

type SignOutButtonProps = Pick<
  ComponentProps<typeof Button>,
  'children' | 'className' | 'disabled' | 'size' | 'variant'
> & {
  onSignOut: () => Promise<void> | void
}

/** Keeps the sign-out action available for retry when the server cannot confirm sign-out. */
export function SignOutButton({
  onSignOut,
  disabled = false,
  children,
  ...buttonProps
}: SignOutButtonProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signOut = async () => {
    setPending(true)
    setError(null)
    try {
      await onSignOut()
    } catch (failure) {
      // Keep the request failure beside the action on every signed-in screen.
      setError(resolveErrorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        {...buttonProps}
        type="button"
        disabled={disabled || pending}
        onClick={() => void signOut()}
      >
        {children}
      </Button>
      {error && (
        <p role="alert" className="text-sm whitespace-normal text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
