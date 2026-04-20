import type { Patient, StockItem, Prescription, ServiceOrder, Sale, LensCatalogItem } from '../types'

export const seedPatients = (): Patient[] => [
  { id: 1, name: 'Marina Costa', cpf: '412.522.891-91', phone: '(11) 98765-4321', birthDate: '09/03/1990', createdAt: '15/01/2026' },
  { id: 2, name: 'Diego Nunes', cpf: '321.118.442-44', phone: '(11) 91234-5678', birthDate: '22/06/1985', createdAt: '20/01/2026' },
  { id: 3, name: 'Lucia Ramos', cpf: '155.300.123-12', phone: '(21) 99876-5432', birthDate: '14/09/1978', createdAt: '01/02/2026' },
  { id: 4, name: 'Carla Mendes', cpf: '289.455.672-67', phone: '(21) 98765-1234', birthDate: '30/12/1992', createdAt: '10/02/2026' },
  { id: 5, name: 'Tiago Costa', cpf: '567.789.231-23', phone: '(11) 97654-3210', birthDate: '05/08/1988', createdAt: '25/02/2026' },
]

export const seedStock = (): StockItem[] => [
  { id: 1, name: 'Lentes Blue Light 1.59', qty: 10, min: 10, price: 189.90, costPrice: 85.00, commissionPct: 5, category: 'Lentes', supplier: 'Zeiss Brasil' },
  { id: 2, name: 'Armação Titan Slim M', qty: 3, min: 8, price: 320.00, costPrice: 120.00, commissionPct: 8, category: 'Armações', supplier: 'Chilli Beans' },
  { id: 3, name: 'Lente Progres. Office', qty: 4, min: 5, price: 350.00, costPrice: 150.00, commissionPct: 5, category: 'Lentes', supplier: 'Essilor' },
  { id: 4, name: 'Armação Classic Round G', qty: 21, min: 10, price: 280.00, costPrice: 95.00, commissionPct: 8, category: 'Armações', supplier: 'Ray-Ban' },
  { id: 5, name: 'Lentes Transitions Gen8', qty: 7, min: 6, price: 450.00, costPrice: 200.00, commissionPct: 5, category: 'Lentes', supplier: 'Transitions Optical' },
  { id: 6, name: 'Flanela de microfibra', qty: 48, min: 20, price: 15.00, costPrice: 3.50, commissionPct: 0, category: 'Acessórios', supplier: 'Genérico' },
  { id: 7, name: 'Antirreflexo Premium', qty: 18, min: 8, price: 120.00, costPrice: 45.00, commissionPct: 5, category: 'Tratamentos', supplier: 'Hoya' },
  { id: 8, name: 'Estojo rígido premium', qty: 30, min: 15, price: 35.00, costPrice: 12.00, commissionPct: 0, category: 'Acessórios', supplier: 'Genérico' },
]

export const seedPrescriptions = (): Prescription[] => [
  { id: 1, patientId: 1, rxOD: { sph: '-1.25', cyl: '-0.50', axis: '90', add: '', dnp: '31.5', height: '18' }, rxOE: { sph: '-1.00', cyl: '-0.25', axis: '85', add: '', dnp: '31.0', height: '17' }, examDate: '15/03/2025', expiresAt: '15/03/2026', lensType: 'Blue Light' },
  { id: 2, patientId: 2, rxOD: { sph: '-2.75', cyl: '-1.00', axis: '180', add: '+2.00', dnp: '32', height: '20' }, rxOE: { sph: '-2.50', cyl: '-0.75', axis: '175', add: '+2.00', dnp: '31.5', height: '19' }, examDate: '20/01/2026', expiresAt: '20/01/2027', lensType: 'Progressiva' },
  { id: 3, patientId: 3, rxOD: { sph: '+1.50', cyl: '-0.25', axis: '45', add: '', dnp: '30', height: '17' }, rxOE: { sph: '+1.75', cyl: '-0.50', axis: '135', add: '', dnp: '30.5', height: '17' }, examDate: '01/02/2026', expiresAt: '01/02/2027', lensType: 'Transitions' },
  { id: 4, patientId: 4, rxOD: { sph: '-0.50', cyl: '', axis: '', add: '', dnp: '31', height: '16' }, rxOE: { sph: '-0.75', cyl: '-0.25', axis: '90', add: '', dnp: '31', height: '16' }, examDate: '10/02/2026', expiresAt: '10/02/2027', lensType: 'Blue Light' },
]

export const seedOrders = (): ServiceOrder[] => [
  { id: 'OS-1482', prescriptionId: 2, patientId: 2, status: 'production', frameItemId: 4, lensItemId: 3, lensQtyUsed: 2, createdAt: '25/02/2026', productionStartedAt: '26/02/2026', readyAt: null, deliveredAt: null, paid: false },
  { id: 'OS-1479', prescriptionId: 4, patientId: 4, status: 'ready', frameItemId: 2, lensItemId: 1, lensQtyUsed: 2, createdAt: '20/02/2026', productionStartedAt: '21/02/2026', readyAt: '05/03/2026', deliveredAt: null, paid: false },
  { id: 'OS-1472', prescriptionId: 1, patientId: 1, status: 'delivered', frameItemId: 4, lensItemId: 1, lensQtyUsed: 2, createdAt: '01/03/2026', productionStartedAt: '02/03/2026', readyAt: '06/03/2026', deliveredAt: '09/03/2026', saleId: 1, paid: true },
  { id: 'OS-1468', prescriptionId: 3, patientId: 3, status: 'production', frameItemId: 2, lensItemId: 5, lensQtyUsed: 2, createdAt: '04/03/2026', productionStartedAt: '05/03/2026', readyAt: null, deliveredAt: null, paid: false },
]

export const seedSales = (): Sale[] => [
  { id: 1, patientId: 1, orderId: 'OS-1472', items: [{ name: 'Armação Classic Round G', price: 280, qty: 1 }], total: 280.00, paymentMethod: 'Cartão crédito', date: '09/03/2026' },
]

export const LENS_CATALOG: LensCatalogItem[] = [
  { id: 1, name: 'Visão Simples CR-39 1.56', description: 'Lente básica para miopia/hipermetropia leve', price: 120.00, lensType: 'Simples', index: '1.56' },
  { id: 2, name: 'Visão Simples Policarbonato 1.59', description: 'Resistente a impacto, ideal para crianças e esportes', price: 180.00, lensType: 'Simples', index: '1.59' },
  { id: 3, name: 'Visão Simples Alto Índice 1.67', description: 'Mais fina, ideal para graus médios', price: 280.00, lensType: 'Simples', index: '1.67' },
  { id: 4, name: 'Visão Simples Ultra Fina 1.74', description: 'Ultra fina, graus altos (+/- 4.00 ou mais)', price: 450.00, lensType: 'Simples', index: '1.74' },
  { id: 5, name: 'Blue Light 1.56', description: 'Filtro de luz azul para uso digital', price: 189.90, lensType: 'Blue Light', index: '1.56' },
  { id: 6, name: 'Blue Light Policarbonato 1.59', description: 'Policarbonato + filtro luz azul', price: 250.00, lensType: 'Blue Light', index: '1.59' },
  { id: 7, name: 'Blue Light Alto Índice 1.67', description: 'Fina + filtro luz azul', price: 350.00, lensType: 'Blue Light', index: '1.67' },
  { id: 8, name: 'Progressiva Standard 1.56', description: 'Multifocal básica', price: 350.00, lensType: 'Progressiva', index: '1.56' },
  { id: 9, name: 'Progressiva Premium 1.67', description: 'Multifocal fina, campo visual ampliado', price: 650.00, lensType: 'Progressiva', index: '1.67' },
  { id: 10, name: 'Progressiva Elite 1.74', description: 'Multifocal ultra fina, máxima precisão', price: 950.00, lensType: 'Progressiva', index: '1.74' },
  { id: 11, name: 'Transitions Gen8 1.56', description: 'Fotossensível, adapta-se à luz', price: 450.00, lensType: 'Transitions', index: '1.56' },
  { id: 12, name: 'Transitions Gen8 1.67', description: 'Fotossensível fina', price: 680.00, lensType: 'Transitions', index: '1.67' },
  { id: 13, name: 'Lente Pronta Leitura', description: 'Óculos pronto para leitura simples (sem grau personalizado)', price: 60.00, lensType: 'Leitura', index: '1.50' },
  { id: 14, name: 'Lente Solar (sem grau)', description: 'Lente escura para óculos de sol', price: 80.00, lensType: 'Solar', index: '1.50' },
]
