# Research notes

Sources consulted while designing the product. Every rule encoded in the deterministic
calculators points back to one of the entries below (look for `SOURCE:` comments in
`backend/atrium/calculators/`). All entries were checked on 2026-09-30.

## Brazilian labour and tax rules

| Topic | Rule as implemented | Source |
|---|---|---|
| INSS 2026 (employee) | Progressive: up to R$ 1.621,00 7,5%; R$ 1.621,01–2.902,84 9%; R$ 2.902,85–4.354,27 12%; R$ 4.354,28–8.475,55 14% (ceiling). 13th salary is computed separately. | Portaria Interministerial MPS/MF nº 13, 09/01/2026 — https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal |
| INSS 2025 (employee) | Up to R$ 1.518,00 7,5%; to 2.793,88 9%; to 4.190,83 12%; to 8.157,41 14%. Validated indirectly by the RFB worked examples (R$ 3.036 → R$ 257,73; R$ 4.000 → R$ 373,41; R$ 5.000 → R$ 509,60; R$ 6.000 → R$ 649,60). | Portaria Interministerial MPS/MF nº 6/2025; https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/exemplos-de-aplicacao-da-lei-15-270-2025 |
| IRRF monthly table 2026 | Exempt up to R$ 2.428,80; 7,5% (−182,16) to 2.826,65; 15% (−394,16) to 3.751,05; 22,5% (−675,49) to 4.664,68; 27,5% (−908,73) above. Dependent R$ 189,59. Simplified discount R$ 607,20 (used when better than legal deductions). | https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026 |
| IRRF monthly table Jan–Apr 2025 | Exempt up to R$ 2.259,20; 7,5% (−169,44); 15% (−381,44); 22,5% (−662,77); 27,5% (−896,00). Simplified discount R$ 564,80. From May 2025 the 2026 table applies. | https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2025 |
| Monthly reduction (Lei 15.270/2025) | Taxable income ≤ R$ 5.000,00: reduction up to R$ 312,89 (tax becomes zero). R$ 5.000,01–7.350,00: reduction = 978,62 − 0,133145 × taxable income (gross, not the base). Never exceeds the computed tax. §3: also applies to the 13th salary exclusive taxation. | Lei 15.270/2025 art. 3º-A of Lei 9.250 — https://www2.camara.leg.br/legin/fed/lei/2025/lei-15270-26-novembro-2025-798354-publicacaooriginal-177117-pl.html ; RFB worked examples 1–5 (used as test vectors) |
| Annual table (calendar year 2026) | Exempt up to R$ 29.145,60; 7,5% (−2.185,92) to 33.919,80; 15% (−4.729,91) to 45.012,60; 22,5% (−8.105,85) to 55.976,16; 27,5% (−10.904,66). Dependent R$ 2.275,08; simplified discount 20% capped at R$ 17.640,00. Annual reduction: ≤ R$ 60.000 up to R$ 2.694,15; R$ 60.000,01–88.200: 8.429,73 − 0,095575 × taxable income. | https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026 |
| PLR exclusive table | Exempt up to R$ 8.214,40; 7,5% (−616,08) to 9.922,28; 15% (−1.360,25) to 13.167,00; 22,5% (−2.347,78) to 16.380,38; 27,5% (−3.166,80). | Same RFB 2026 page |
| PGBL deduction | Contributions deductible up to 12% of total taxable income in the annual return, only in the complete model and only for taxpayers who also contribute to the official social security regime. Taxed on withdrawal. | Lei 9.532/1997 art. 11; Perguntas e Respostas IRPF 2026 (RFB) — https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirpf/p-r-irpf-2026-v1-00-2026-04-23.pdf |
| Vacation split | Up to three periods with employee agreement; one ≥ 14 calendar days, others ≥ 5 calendar days. | CLT art. 134 §1 (Lei 13.467/2017) — https://www2.camara.leg.br/legin/fed/lei/2017/lei-13467-13-julho-2017-785204-publicacaooriginal-153369-pl.html |
| Vacation start | Forbidden to start in the two days preceding a holiday or the weekly paid rest (DSR). | CLT art. 134 §3 (same source) |
| Vacation entitlement | 30 days (≤ 5 unjustified absences), 24 (6–14), 18 (15–23), 12 (24–32). | CLT art. 130 — http://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm |
| Double pay | Vacation granted after the concession period (12 months after the acquisition period) is paid in double; days enjoyed after the deadline count double. | CLT art. 137; TST Súmula 81 |
| Cash allowance (abono pecuniário) | Employee may convert 1/3 of the entitlement into cash, requested up to 15 days before the end of the acquisition period. Abono + its 1/3 are not taxed by IRRF/INSS. | CLT art. 143; Lei 8.212/1991 art. 28 §9º "e" 6; Ato Declaratório PGFN 6/2006 |
| 1/3 vacation bonus | Constitutional one-third on vacation pay. | CF art. 7º XVII |
| 13th advance on vacation | First installment of the 13th paid with vacation if requested in January. | Lei 4.749/1965 art. 2º §2º |
| Paternity leave | 5 days (ADCT art. 10 §1º) in 2026; Lei 15.371/2026 raises it gradually to 10 days (2027), 15 (2028), 20 (2029). Empresa Cidadã adds 15 days (Lei 11.770/2008 as amended by Lei 13.257/2016). | https://www.camara.leg.br/noticias/1259716-lei-amplia-licenca-paternidade-para-20-dias-e-cria-salario-paternidade |
| Maternity leave | 120 days (CF art. 7º XVIII) + 60 with Empresa Cidadã. | Lei 11.770/2008 |
| Newborn on health plan | Newborn enrolled within 30 days of birth is exempt from waiting periods (carência). | Lei 9.656/1998 art. 12, III, "b" |
| Holidays | National: Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023 (20/11). São Paulo state: 9 July (Lei estadual 9.497/1997). São Paulo city: 25 January and Corpus Christi (Lei municipal 14.485/2007). Carnival is an optional day (ponto facultativo) granted by company policy. | Respective laws |

## Agent platforms and security

| Topic | Takeaway for the design |
|---|---|
| Enterprise copilots (Microsoft Copilot Studio, ServiceNow HR Service Delivery with Now Assist, Workday Assistant, Moveworks) | Common pattern: a single conversational entry point, a router that picks a "topic"/"skill"/"plugin", connectors to systems of record, admin-side analytics of unresolved questions, and DLP policies on which connectors an agent may use. Atrium makes the same concepts explicit and auditable: governed tool catalog with risk levels, publication gate with evaluation, and identity-bound tools. |
| OWASP Top 10 for LLM Applications (2025) | LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM03 Supply Chain, LLM04 Data and Model Poisoning, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM08 Vector and Embedding Weaknesses, LLM09 Misinformation, LLM10 Unbounded Consumption. Mapped control by control in `docs/security-model.md`. https://genai.owasp.org/llm-top-10/ |
| Confused deputy in agents and MCP | A tool server acting with its own broad privileges on behalf of a caller can be tricked into acting for someone else. MCP security best practices forbid token passthrough and require per-user authorization at the resource. Atrium answers this by never letting the model name the subject of a self-service tool and by re-authorizing every call against the authenticated identity. https://modelcontextprotocol.io/specification/draft/basic/security_best_practices |

## Embeddings

`fastembed` 0.8.1 supports `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
(384 dimensions, 0.22 GB, Apache-2.0) on CPU through ONNX Runtime. Chosen in ADR 0008.
