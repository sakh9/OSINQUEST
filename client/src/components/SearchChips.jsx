export default function SearchChips({ title, icon: Icon, items, onSelect }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-2 uppercase tracking-wide">
        {Icon && <Icon size={12} />}
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onSelect(item)}
            className="text-sm bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 px-3 py-1.5 rounded-full transition-colors"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}