import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function TablePagination({ page, pageSize, total, onPageChange, label = 'records' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const start = total ? (page - 1) * pageSize + 1 : 0
  const end = Math.min(page * pageSize, total)
  const first = Math.max(1, Math.min(page - 2, pages - 4))
  const pageNumbers = Array.from({ length: Math.min(5, pages) }, (_, index) => first + index)
  return <footer className="shared-table-pagination" aria-label={`${label} pagination`}>
    <span className="shared-pagination-summary">Showing <b>{start}–{end}</b> of <b>{total}</b> {label}</span>
    <nav aria-label={`${label} pages`}>
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={16}/></button>
      {pageNumbers.map((number) => <button type="button" key={number} className={number === page ? 'is-active' : ''} onClick={() => onPageChange(number)} aria-label={`Page ${number}`} aria-current={number === page ? 'page' : undefined}>{number}</button>)}
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={16}/></button>
    </nav>
    <span className="shared-pagination-page">Page {page} of {pages}</span>
  </footer>
}
