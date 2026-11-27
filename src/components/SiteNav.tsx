import { Link } from "@tanstack/react-router";
import { Activity, Coins, FileKey, LayoutDashboard, Settings, Shield, Terminal } from "lucide-react";

const LINKS = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/configuration", label: "Configuration", icon: Settings },
  { to: "/admin", label: "Accès vocaux", icon: Shield },
  { to: "/statut", label: "Statut des bots", icon: Activity },
  { to: "/economie", label: "Économie", icon: Coins },
  { to: "/installation", label: "Installation", icon: FileKey },
] as const;

/** One navigation bar shared by every page of the site. */
export function SiteNav() {
  return (
    <nav aria-label="Navigation du site" className="site-nav border-b border-border px-4 md:px-8">
      <ul className="mx-auto flex max-w-[1376px] gap-1 overflow-x-auto py-2">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="shrink-0">
            <Link to={to} activeOptions={{ exact: to === "/" }} className="site-nav-link" activeProps={{ "aria-current": "page" }}>
              <Icon className="h-4 w-4" /> {label}
            </Link>
          </li>
        ))}
        {/* Page statique (public/console/) : pas une route typée, donc un lien ordinaire. */}
        <li className="shrink-0">
          <a href="/console/" className="site-nav-link">
            <Terminal className="h-4 w-4" /> Console
          </a>
        </li>
      </ul>
    </nav>
  );
}
