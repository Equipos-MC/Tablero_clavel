export function assemblyForQuantity<T extends { target: number; made: number; pending: number }>(assembly: T, quantity?: number): T {
  if (!quantity) return assembly;
  const made = Math.min(quantity, Math.max(0, assembly.made));
  return { ...assembly, target: quantity, made, pending: quantity - made };
}

export function productionProgress(assemblies: { made: number }[], quantity?: number) {
  const total = (quantity || 0) * assemblies.length;
  const made = quantity ? assemblies.reduce((sum, assembly) => sum + Math.min(quantity, Math.max(0, assembly.made)), 0) : 0;
  return { made, pending: total - made, total, types: assemblies.length, percent: total ? Math.round(made / total * 100) : 0 };
}
