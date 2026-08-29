import { NavLink } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(buttonVariants({ variant: isActive ? "default" : "ghost", size: "sm" }));

export default function Header() {
  return (
    <div className="flex items-center justify-between gap-4 border-b px-6 py-3.5">
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
        className="hidden text-xs text-muted-foreground hover:text-foreground sm:block"
      >
        markitdown
      </a>
    </div>
  );
}
