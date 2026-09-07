/* ============================================================
   sistema-futbol — Interfaz
   ------------------------------------------------------------
   Lee el formulario, llama al motor, pinta el resultado y publica el JSON
   de §25. Todo lo que se muestra en pantalla se formatea aquí; los datos
   siguen siendo números decimales dentro del JSON.
   ============================================================ */

(function () {
  'use strict';

  const M = window.SFModelo;
  const R = window.SFReglas;
  const V = window.SFValidador;
  const esNum = M.esNum;

  const MEDIA_LIGA_REFERENCIA = 2.60;

  const GRUPOS = [
    { id: 'RESULTADO', titulo: 'Resultado' },
    { id: 'DOBLE', titulo: 'Doble oportunidad' },
    { id: 'GOLES', titulo: 'Goles' },
    { id: 'BTTS', titulo: 'Ambos marcan' },
    { id: 'EQUIPO_LOCAL', titulo: 'Goles del local' },
    { id: 'EQUIPO_VISITANTE', titulo: 'Goles del visitante' }
  ];

  const ETIQUETA_RIESGO = {
    MUY_BAJO: 'Muy bajo', BAJO: 'Bajo', MEDIO: 'Medio', ALTO: 'Alto', MUY_ALTO: 'Muy alto'
  };
  const ETIQUETA_VALOR = { POSITIVE: 'Positivo', NEUTRAL: 'Neutral', NEGATIVE: 'Negativo' };

  let ultimoAnalisis = null;

  /* --- Utilidades de DOM y formato --- */
  const $ = id => document.getElementById(id);
  const crear = (tag, clase, texto) => {
    const el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  };

  function leerNumero(id) {
    const el = $(id);
    if (!el) return null;
    const bruto = String(el.value).trim().replace(',', '.');
    if (bruto === '') return null;
    const n = parseFloat(bruto);
    return isFinite(n) ? n : null;
  }

  const leerTexto = id => String($(id).value || '').trim();

  const pct = v => (esNum(v) ? (v * 100).toFixed(1).replace('.', ',') + ' %' : '—');
  const dec = (v, d) => (esNum(v) ? v.toFixed(d === undefined ? 2 : d).replace('.', ',') : '—');
  const firmado = (v, d) => (esNum(v) ? (v > 0 ? '+' : '') + dec(v, d) : '—');

  /* --- Navegación --- */
  function activarPestana(nombre) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-' + nombre));
  }

  /* --- Rejilla de cuotas, generada desde el catálogo de mercados --- */
  function construirRejillaCuotas() {
    const cont = $('grid-cuotas');
    GRUPOS.forEach(function (g) {
      const bloque = crear('div', 'odds-group');
      bloque.appendChild(crear('h4', 'odds-group-title', g.titulo));
      const fila = crear('div', 'odds-row');
      R.MERCADOS.filter(m => m.grupo === g.id).forEach(function (m) {
        const campo = crear('div', 'field field-odd');
        const label = crear('label', null, m.nombre);
        label.setAttribute('for', 'cuota-' + m.id);
        const input = document.createElement('input');
        input.type = 'number';
        input.id = 'cuota-' + m.id;
        input.step = '0.01';
        input.min = '1.01';
        input.placeholder = '—';
        input.dataset.mercado = m.id;
        campo.appendChild(label);
        campo.appendChild(input);
        fila.appendChild(campo);
      });
      bloque.appendChild(fila);
      cont.appendChild(bloque);
    });
  }

  function leerCuotas() {
    const cuotas = {};
    R.IDS_MERCADO.forEach(function (id) {
      const v = leerNumero('cuota-' + id);
      if (esNum(v) && v > 1) cuotas[id] = v;
    });
    return cuotas;
  }

  /* --- Lectura del formulario --- */
  function leerEntrada() {
    const mediaIntroducida = leerNumero('in-media-liga');
    return {
      partido: {
        local: leerTexto('in-local'),
        visitante: leerTexto('in-visitante'),
        competicion: leerTexto('in-competicion'),
        fecha: leerTexto('in-fecha'),
        tipo: $('in-tipo').value
      },
      liga: {
        golesPorPartido: esNum(mediaIntroducida) ? mediaIntroducida : MEDIA_LIGA_REFERENCIA,
        mediaProvista: esNum(mediaIntroducida),
        datosGlobales: $('in-globales').checked,
        ventajaLocal: leerNumero('in-ventaja')
      },
      local: {
        pj: leerNumero('l-pj'), gf: leerNumero('l-gf'), gc: leerNumero('l-gc'),
        forma: leerNumero('l-forma'), bajas: leerNumero('l-bajas'), descanso: leerNumero('l-descanso')
      },
      visitante: {
        pj: leerNumero('v-pj'), gf: leerNumero('v-gf'), gc: leerNumero('v-gc'),
        forma: leerNumero('v-forma'), bajas: leerNumero('v-bajas'), descanso: leerNumero('v-descanso')
      },
      cuotas: leerCuotas()
    };
  }

  /* --- Análisis --- */
  function analizar() {
    const entrada = leerEntrada();
    const faltan = [];
    if (!esNum(entrada.local.gf) || !esNum(entrada.local.gc)) faltan.push('goles del local');
    if (!esNum(entrada.visitante.gf) || !esNum(entrada.visitante.gc)) faltan.push('goles del visitante');

    const salida = R.analizar(entrada);
    ultimoAnalisis = salida;

    renderResultado(salida);

    const msg = $('form-msg');
    if (faltan.length) {
      msg.className = 'form-msg warn';
      msg.textContent = 'Análisis generado sin ' + faltan.join(' ni ') + ': los campos numéricos salen en null.';
    } else {
      msg.className = 'form-msg ok';
      msg.textContent = 'Análisis generado.';
    }
    activarPestana('resultado');
  }

  /* --- Render del resultado --- */
  function renderResultado(salida) {
    const d = salida.json;
    const meta = salida.meta;

    $('resultado-vacio').hidden = true;
    $('resultado-cuerpo').hidden = false;

    const local = d.match.homeTeam || 'Local';
    const visitante = d.match.awayTeam || 'Visitante';
    $('res-titulo').textContent = local + ' vs ' + visitante;
    $('res-subtitulo').textContent = [d.match.competition, d.match.date]
      .filter(t => t !== '').join(' · ') || 'Sin competición ni fecha registradas.';

    // KPIs
    const dist = meta.distribucion;
    $('res-xg').textContent = dist ? dec(dist.golesEsperados.total) : '—';
    $('res-xg-detalle').textContent = dist
      ? 'Local ' + dec(dist.lambdas.lambdaLocal) + ' · Visitante ' + dec(dist.lambdas.lambdaVisitante)
      : 'Sin datos suficientes para estimar goles esperados.';

    $('res-calidad').textContent = esNum(d.dataQuality.score) ? d.dataQuality.score + ' / 100' : '—';
    $('res-calidad-comentario').textContent = d.dataQuality.comment;

    const val = V.validar(d);
    $('res-validacion').textContent = val.ok ? 'Correcta' : val.errores.length + ' errores';
    $('res-validacion').className = 'kpi-value ' + (val.ok ? 'texto-ok' : 'texto-error');
    $('res-validacion-detalle').textContent = val.ok
      ? (val.advertencias.length ? val.advertencias.length + ' advertencias, sin errores.' : 'Estructura, rangos y aritmética conformes.')
      : val.errores.map(e => e.campo).join(', ');

    // Barras 1X2 + goles
    const barras = $('res-1x2');
    barras.innerHTML = '';
    [
      ['Gana ' + local, d.probabilities.homeWin],
      ['Empate', d.probabilities.draw],
      ['Gana ' + visitante, d.probabilities.awayWin],
      ['Over 1.5', d.goals.over1_5],
      ['Over 2.5', d.goals.over2_5],
      ['Ambos marcan', d.bothTeamsToScore.yes],
      [local + ' marca', d.teamGoals.homeOver0_5],
      [visitante + ' marca', d.teamGoals.awayOver0_5]
    ].forEach(function (par) {
      const fila = crear('div', 'bar-row');
      fila.appendChild(crear('span', 'bar-label', par[0]));
      const pista = crear('div', 'bar-track');
      const relleno = crear('div', 'bar-fill');
      relleno.style.width = (esNum(par[1]) ? par[1] * 100 : 0) + '%';
      pista.appendChild(relleno);
      fila.appendChild(pista);
      fila.appendChild(crear('span', 'bar-value', pct(par[1])));
      barras.appendChild(fila);
    });

    // Marcadores
    const cont = $('res-marcadores');
    cont.innerHTML = '';
    if (!d.mostLikelyScores.length) {
      cont.appendChild(crear('p', 'muted', 'Sin datos suficientes para estimar marcadores.'));
    } else {
      d.mostLikelyScores.forEach(function (s) {
        const chip = crear('div', 'score-chip');
        chip.appendChild(crear('span', 'score-value', s.score));
        chip.appendChild(crear('span', 'score-prob', pct(s.probability)));
        cont.appendChild(chip);
      });
    }

    // Pronósticos
    const pron = $('res-pronosticos');
    pron.innerHTML = '';
    pron.appendChild(tarjetaPronostico('Pronóstico principal', d.mainPrediction));
    pron.appendChild(tarjetaPronostico('Alternativa', d.alternativePrediction));

    const evitar = $('res-evitar');
    evitar.innerHTML = '';
    if (d.avoidMarket.market) {
      evitar.appendChild(crear('span', 'avoid-tag', 'Evitar'));
      evitar.appendChild(crear('strong', null, R.nombreDe(d.avoidMarket.market)));
      evitar.appendChild(crear('p', null, d.avoidMarket.reason));
    } else {
      evitar.appendChild(crear('p', 'muted', 'No se identificó ningún mercado especialmente engañoso con los datos disponibles.'));
    }

    // Tabla de mercados
    const tbody = $('tabla-mercados').querySelector('tbody');
    tbody.innerHTML = '';
    meta.mercados.forEach(function (m) {
      const tr = document.createElement('tr');
      if (d.mainPrediction.market === m.market) tr.className = 'fila-principal';
      else if (d.alternativePrediction.market === m.market) tr.className = 'fila-alternativa';

      tr.appendChild(crear('td', null, m.nombre));
      tr.appendChild(crear('td', 'num', pct(m.probability)));
      tr.appendChild(crear('td', 'num', esNum(m.odds) ? dec(m.odds) : '—'));
      tr.appendChild(crear('td', 'num', pct(m.impliedProbability)));

      const tdDes = crear('td', 'num', esNum(m.desviacion) ? firmado(m.desviacion) : '—');
      if (m.desviacionAlta) tdDes.classList.add('texto-error');
      tr.appendChild(tdDes);

      const tdEv = crear('td', 'num', esNum(m.ev) ? firmado(m.ev, 3) : '—');
      if (esNum(m.ev)) tdEv.classList.add(m.ev > 0 ? 'texto-ok' : 'texto-error');
      tr.appendChild(tdEv);

      const tdRiesgo = document.createElement('td');
      if (m.risk) {
        const badge = crear('span', 'badge risk-' + m.risk.toLowerCase(), ETIQUETA_RIESGO[m.risk]);
        tdRiesgo.appendChild(badge);
      } else {
        tdRiesgo.textContent = '—';
      }
      tr.appendChild(tdRiesgo);

      tr.appendChild(crear('td', 'num', esNum(m.confidence) ? String(m.confidence) : '—'));

      const tdValor = document.createElement('td');
      if (m.value) tdValor.appendChild(crear('span', 'badge value-' + m.value.toLowerCase(), ETIQUETA_VALOR[m.value]));
      else tdValor.textContent = '—';
      tr.appendChild(tdValor);

      tbody.appendChild(tr);
    });

    // Escenarios
    const esc = $('res-escenarios');
    esc.innerHTML = '';
    d.scenarios.forEach(function (s) {
      const bloque = crear('div', 'escenario');
      const cab = crear('div', 'escenario-cab');
      cab.appendChild(crear('strong', null, s.id.replace('ESCENARIO_', '').toLowerCase()));
      cab.appendChild(crear('span', 'mono', pct(s.probability)));
      bloque.appendChild(cab);
      bloque.appendChild(crear('p', null, s.description || 'Sin descripción disponible.'));
      esc.appendChild(bloque);
    });

    // Factores clave
    const ul = $('res-factores');
    ul.innerHTML = '';
    if (!d.keyFactors.length) {
      ul.appendChild(crear('li', 'muted', 'No se identificaron factores con los datos aportados.'));
    } else {
      d.keyFactors.forEach(f => ul.appendChild(crear('li', null, f)));
    }

    $('res-conclusion').textContent = d.conclusion;
  }

  function tarjetaPronostico(titulo, p) {
    const card = crear('div', 'pron-card');
    card.appendChild(crear('span', 'pron-titulo', titulo));

    if (!p.market) {
      card.appendChild(crear('p', 'muted', 'Ningún mercado cumple los criterios mínimos de probabilidad, riesgo y valor.'));
      return card;
    }

    card.appendChild(crear('h4', 'pron-mercado', R.nombreDe(p.market)));

    const linea = crear('div', 'pron-datos');
    [
      ['Probabilidad', pct(p.probability)],
      ['Cuota', esNum(p.odds) ? dec(p.odds) : '—'],
      ['Implícita', pct(p.impliedProbability)],
      ['EV', esNum(p.ev) ? firmado(p.ev, 3) : '—'],
      ['Confianza', esNum(p.confidence) ? String(p.confidence) : '—']
    ].forEach(function (par) {
      const item = crear('div', 'dato');
      item.appendChild(crear('span', 'dato-label', par[0]));
      item.appendChild(crear('span', 'dato-valor', par[1]));
      linea.appendChild(item);
    });
    card.appendChild(linea);

    if (p.risk) {
      card.appendChild(crear('span', 'badge risk-' + p.risk.toLowerCase(), 'Riesgo ' + ETIQUETA_RIESGO[p.risk].toLowerCase()));
    }
    card.appendChild(crear('p', 'pron-justificacion', p.justification));
    return card;
  }

  /* --- Validador --- */
  function renderValidacion(contenedor, resultado) {
    contenedor.innerHTML = '';

    const cab = crear('div', 'val-cab ' + (resultado.ok ? 'ok' : 'error'));
    cab.textContent = resultado.ok
      ? 'Validación superada' + (resultado.advertencias.length ? ' con ' + resultado.advertencias.length + ' advertencias.' : ': sin errores ni advertencias.')
      : 'Validación fallida: ' + resultado.errores.length + ' errores.';
    contenedor.appendChild(cab);

    function lista(titulo, items, clase) {
      if (!items.length) return;
      contenedor.appendChild(crear('h4', 'val-titulo', titulo));
      const ul = crear('ul', 'val-lista ' + clase);
      items.forEach(function (it) {
        const li = document.createElement('li');
        li.appendChild(crear('code', null, it.campo));
        li.appendChild(document.createTextNode(' ' + it.mensaje));
        ul.appendChild(li);
      });
      contenedor.appendChild(ul);
    }

    lista('Errores', resultado.errores, 'errores');
    lista('Advertencias', resultado.advertencias, 'advertencias');
  }

  function validarPegado() {
    const salida = $('val-salida');
    const bruto = $('val-input').value.trim();
    if (!bruto) {
      salida.innerHTML = '';
      salida.appendChild(crear('div', 'val-cab error', 'No hay nada que validar: pega el JSON en el cuadro.'));
      return;
    }
    let data;
    try {
      data = JSON.parse(bruto);
    } catch (e) {
      salida.innerHTML = '';
      salida.appendChild(crear('div', 'val-cab error', 'El texto no es JSON válido: ' + e.message));
      return;
    }
    renderValidacion(salida, V.validar(data));
  }

  /* --- Portapapeles y descarga --- */
  function copiar(texto, msgId, etiqueta) {
    const msg = $(msgId);
    function ok() {
      msg.className = 'form-msg ok';
      msg.textContent = etiqueta + ' copiado al portapapeles.';
    }
    function fallo() {
      msg.className = 'form-msg warn';
      msg.textContent = 'El navegador bloqueó el portapapeles. Selecciona el texto y copia a mano.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(ok).catch(function () { respaldo(texto) ? ok() : fallo(); });
    } else {
      respaldo(texto) ? ok() : fallo();
    }
  }

  function respaldo(texto) {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function descargarJson() {
    if (!ultimoAnalisis) {
      $('json-msg').className = 'form-msg warn';
      $('json-msg').textContent = 'Genera primero un análisis.';
      return;
    }
    const d = ultimoAnalisis.json;
    const nombre = [d.match.homeTeam || 'local', d.match.awayTeam || 'visitante']
      .join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '.json';
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    $('json-msg').className = 'form-msg ok';
    $('json-msg').textContent = 'Archivo ' + nombre + ' descargado.';
  }

  /* --- Prompt --- */
  function cargarPrompt() {
    const destino = $('prompt-out');
    fetch('PROMPT_MAESTRO.md')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (t) { destino.textContent = t; })
      .catch(function () {
        destino.textContent = 'No se pudo cargar PROMPT_MAESTRO.md desde el navegador. ' +
          'Ocurre al abrir la página con doble clic (protocolo file://), que bloquea la lectura de archivos locales. ' +
          'Sirve la carpeta por HTTP (por ejemplo con "python -m http.server 8090") o abre el archivo PROMPT_MAESTRO.md directamente.';
      });
  }

  /* --- Datos de ejemplo (valores de demostración, no de un partido real) --- */
  function cargarEjemplo() {
    const valores = {
      'in-local': 'Getafe CF', 'in-visitante': 'Celta de Vigo',
      'in-competicion': 'LaLiga', 'in-media-liga': '2.60',
      'l-pj': '10', 'l-gf': '1.10', 'l-gc': '0.90', 'l-forma': '6', 'l-bajas': '0', 'l-descanso': '7',
      'v-pj': '10', 'v-gf': '1.20', 'v-gc': '1.60', 'v-forma': '5', 'v-bajas': '0', 'v-descanso': '7',
      'cuota-LOCAL': '2.82', 'cuota-EMPATE': '2.72', 'cuota-VISITANTE': '3.05',
      'cuota-DOBLE_1X': '1.40', 'cuota-DOBLE_X2': '1.45', 'cuota-DOBLE_12': '1.42',
      'cuota-OVER_0_5': '1.19', 'cuota-OVER_1_5': '1.78', 'cuota-OVER_2_5': '3.35', 'cuota-OVER_3_5': '6.80',
      'cuota-UNDER_1_5': '2.05', 'cuota-UNDER_2_5': '1.33', 'cuota-UNDER_3_5': '1.11',
      'cuota-BTTS_SI': '2.47', 'cuota-BTTS_NO': '1.50',
      'cuota-LOCAL_OVER_0_5': '1.57', 'cuota-LOCAL_OVER_1_5': '3.60',
      'cuota-VISITANTE_OVER_0_5': '1.62', 'cuota-VISITANTE_OVER_1_5': '3.80'
    };
    Object.keys(valores).forEach(function (id) { if ($(id)) $(id).value = valores[id]; });
    $('in-tipo').value = 'LIGA';
    $('in-globales').checked = false;
    sincronizarLocalia();
    const hoy = new Date();
    $('in-fecha').value = hoy.toISOString().slice(0, 10);
    $('form-msg').className = 'form-msg';
    $('form-msg').textContent = 'Datos de ejemplo cargados: sustitúyelos por los del partido real.';
  }

  function cargarDesdeJsonInput() {
    const msg = $('json-input-msg');
    if (!msg) return; // Si no existe el contenedor
    const input = $('in-json-input').value.trim();
    if (!input) {
      msg.className = 'form-msg warn';
      msg.textContent = 'Pega el JSON primero.';
      return;
    }
    let data;
    try {
      data = JSON.parse(input);
    } catch (e) {
      msg.className = 'form-msg warn';
      msg.textContent = 'JSON inválido: ' + e.message;
      return;
    }
    
    try {
      if (data.encuentro) {
        if (data.encuentro.equipo_local) $('in-local').value = data.encuentro.equipo_local;
        if (data.encuentro.equipo_visitante) $('in-visitante').value = data.encuentro.equipo_visitante;
        if (data.encuentro.competicion) $('in-competicion').value = data.encuentro.competicion;
        if (data.encuentro.fecha) {
          let d = data.encuentro.fecha;
          if (d.includes('/')) {
             const parts = d.split('/');
             if (parts.length === 3) d = parts[2] + '-' + parts[1] + '-' + parts[0];
          }
          $('in-fecha').value = d;
        }
        if (data.encuentro.tipo_de_partido) {
           let t = data.encuentro.tipo_de_partido.toUpperCase();
           $('in-tipo').value = (t.includes('COPA')) ? 'COPA' : 'LIGA';
        }
        if (esNum(data.encuentro.media_goles_competicion)) $('in-media-liga').value = data.encuentro.media_goles_competicion;
        if (esNum(data.encuentro.ventaja_localia)) $('in-ventaja').value = data.encuentro.ventaja_localia;
        if (data.encuentro.promedios_globales !== undefined) $('in-globales').checked = !!data.encuentro.promedios_globales;
      }

      if (data.local_en_casa) {
        if (esNum(data.local_en_casa.partidos_muestra)) $('l-pj').value = data.local_en_casa.partidos_muestra;
        if (esNum(data.local_en_casa.goles_a_favor)) $('l-gf').value = data.local_en_casa.goles_a_favor;
        if (esNum(data.local_en_casa.goles_en_contra)) $('l-gc').value = data.local_en_casa.goles_en_contra;
        if (esNum(data.local_en_casa.forma_puntos_ultimos_5)) $('l-forma').value = data.local_en_casa.forma_puntos_ultimos_5;
        if (esNum(data.local_en_casa.impacto_bajas)) $('l-bajas').value = data.local_en_casa.impacto_bajas;
        if (esNum(data.local_en_casa.dias_descanso)) $('l-descanso').value = data.local_en_casa.dias_descanso;
      }

      if (data.visitante_fuera_de_casa) {
        if (esNum(data.visitante_fuera_de_casa.partidos_muestra)) $('v-pj').value = data.visitante_fuera_de_casa.partidos_muestra;
        if (esNum(data.visitante_fuera_de_casa.goles_a_favor)) $('v-gf').value = data.visitante_fuera_de_casa.goles_a_favor;
        if (esNum(data.visitante_fuera_de_casa.goles_en_contra)) $('v-gc').value = data.visitante_fuera_de_casa.goles_en_contra;
        if (esNum(data.visitante_fuera_de_casa.forma_puntos_ultimos_5)) $('v-forma').value = data.visitante_fuera_de_casa.forma_puntos_ultimos_5;
        if (esNum(data.visitante_fuera_de_casa.impacto_bajas)) $('v-bajas').value = data.visitante_fuera_de_casa.impacto_bajas;
        if (esNum(data.visitante_fuera_de_casa.dias_descanso)) $('v-descanso').value = data.visitante_fuera_de_casa.dias_descanso;
      }

      // Las cuotas ya no se cargan desde el JSON por petición del usuario


      sincronizarLocalia();
      msg.className = 'form-msg ok';
      msg.textContent = 'JSON cargado con éxito.';
    } catch (e) {
      msg.className = 'form-msg warn';
      msg.textContent = 'Error al procesar el JSON: ' + e.message;
    }
  }

  function limpiar() {
    document.querySelectorAll('#tab-datos input').forEach(function (el) {
      if (el.type === 'checkbox') el.checked = false;
      else if (el.id !== 'in-ventaja') el.value = '';
    });
    $('in-ventaja').value = '1.10';
    $('in-tipo').value = 'LIGA';
    sincronizarLocalia();
    ultimoAnalisis = null;
    $('resultado-vacio').hidden = false;
    $('resultado-cuerpo').hidden = true;
    $('form-msg').className = 'form-msg';
    $('form-msg').textContent = 'Formulario vacío.';
  }

  function sincronizarLocalia() {
    const globales = $('in-globales').checked;
    $('in-ventaja').disabled = !globales;
    $('tag-local').textContent = globales ? 'promedios globales' : 'en casa';
    $('tag-visitante').textContent = globales ? 'promedios globales' : 'fuera de casa';
  }

  /* --- Arranque --- */
  function init() {
    construirRejillaCuotas();

    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', () => activarPestana(b.dataset.tab));
    });

    $('btn-analizar').addEventListener('click', analizar);
    $('btn-ejemplo').addEventListener('click', cargarEjemplo);
    if ($('btn-cargar-json-input')) {
      $('btn-cargar-json-input').addEventListener('click', cargarDesdeJsonInput);
    }
    $('btn-limpiar').addEventListener('click', limpiar);
    $('in-globales').addEventListener('change', sincronizarLocalia);

    sincronizarLocalia();
    cargarEjemplo();
    analizar();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
