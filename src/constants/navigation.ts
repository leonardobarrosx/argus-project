import {
  LayoutDashboard, ShoppingCart, UserRound, FlaskConical, Boxes, Briefcase, BarChart3,
} from 'lucide-react'
import type { PageKey } from '../types'

export const NAV: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { key: 'pdv', label: 'PDV', icon: ShoppingCart },
  { key: 'patients', label: 'Pacientes', icon: UserRound },
  { key: 'lab', label: 'Laboratório', icon: FlaskConical },
  { key: 'stock', label: 'Estoque', icon: Boxes },
  { key: 'collaborators', label: 'Equipe', icon: Briefcase },
  { key: 'reports', label: 'Relatórios', icon: BarChart3 },
]

export const BOTTOM_BAR_KEYS: PageKey[] = ['overview', 'pdv', 'patients', 'lab']
