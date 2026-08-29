import { NavLink } from "react-router-dom";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
    isActive
      ? "bg-zinc-900 text-white"
      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
  }`;

export default function Header() {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3.5">
      <div className="flex items-center gap-6">
        <span className="text-[0.95rem] font-semibold tracking-tight">Momo</span>
        <nav className="flex items-center gap-1">
          <NavLink to="/playground" className={linkClass}>
            Playground
          </NavLink>
          <NavLink to="/project" className={linkClass}>
            Projects
          </NavLink>
        </nav>
      </div>
      <a
        href="https://github.com/microsoft/markitdown"
        target="_blank"
        rel="noopener noreferrer"
        className="hidden text-xs text-zinc-400 hover:text-zinc-700 sm:block"
      >
        markitdown
      </a>
    </div>
  );
}
