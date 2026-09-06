import { LogOut, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'

export default function LogoutConfirmModal({ open, busy = false, onCancel, onConfirm }) {
  const cancelButtonRef = useRef(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButtonRef.current?.focus()
    const handleEscape = (event) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [busy, onCancel, open])

  const backdropMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
  const modalMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.97, y: 10 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.985, y: 8 },
        transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
      }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="payment-modal-backdrop auth-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onCancel()
          }}
          {...backdropMotion}
        >
          <motion.section
            className="payment-modal auth-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
            aria-describedby="logout-confirm-copy"
            {...modalMotion}
          >
            <button
              className="payment-modal-close auth-confirm-close"
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="Close logout confirmation"
            >
              <X size={20} />
            </button>
            <span className="auth-confirm-icon" aria-hidden="true">
              <LogOut size={30} strokeWidth={2} />
            </span>
            <h2 id="logout-confirm-title">Sign out?</h2>
            <p id="logout-confirm-copy">
              You will be signed out and returned to the login screen.
            </p>
            <div className="payment-modal-actions auth-confirm-actions">
              <button
                ref={cancelButtonRef}
                className="secondary-button"
                type="button"
                onClick={onCancel}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={onConfirm} disabled={busy}>
                {busy ? 'Signing out...' : 'Sign Out'}
              </button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
