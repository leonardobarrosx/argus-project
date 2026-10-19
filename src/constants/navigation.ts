import {
  LayoutDashboard, ShoppingCart, UserRound, FlaskConical, Boxes, Briefcase, BarChart3, Wallet, Landmark,
  Truck, Settings,
} from 'lucide-react'
import type { PageKey } from '../types'

export type NavItem = { key: PageKey; label: string; icon: typeof LayoutDashboard }

export const NAV: NavItem[] = [
  { key: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { key: 'pdv', label: 'PDV', icon: ShoppingCart },
  { key: 'cash', label: 'Caixa', icon: Wallet },
  { key: 'patients', label: 'Pacientes', icon: UserRound },
  { key: 'lab', label: 'Laboratório', icon: FlaskConical },
  { key: 'stock', label: 'Estoque', icon: Boxes },
  { key: 'suppliers', label: 'Fornecedores', icon: Truck },
  { key: 'finance', label: 'Financeiro', icon: Landmark },
  { key: 'collaborators', label: 'Equipe', icon: Briefcase },
  { key: 'reports', label: 'Relatórios', icon: BarChart3 },
  { key: 'settings', label: 'Configurações', icon: Settings },
]

export const BOTTOM_BAR_KEYS: PageKey[] = ['overview', 'pdv', 'patients', 'lab']
