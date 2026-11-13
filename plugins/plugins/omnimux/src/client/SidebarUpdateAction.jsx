/**
 * Occupies `sidebar.footer.action` (`omnimux-desktop-updater`) so the seat
 * stays owned by the hub. Desktop Host has no GET /status (and no download/
 * apply routes), so this slot renders nothing and must not fetch on mount.
 */
export function SidebarUpdateAction() {
  return null
}
