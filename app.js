(() => {
  const { useEffect, useRef, useState } = React;

  const STATUS_STYLES = {
    deal: { label: "Deal", color: "#5c6b7a", width: 1.6 },
    no_deal: { label: "No deal", color: "#d4dbe4", width: 0.8, dash: [1, 7] }
  };

  const EDGE_ALPHA = {
    deal: { base: 0.3, active: 0.9, dim: 0.04 },
    no_deal: { base: 0.05, active: 0.15, dim: 0.02 }
  };

  const HIGHLIGHT = {
    outgoing: {
      fill: "#e4f7f1",
      halo: "rgba(24, 143, 124, 0.12)",
      stroke: "#188f7c"
    },
    incoming: {
      fill: "#e7ecff",
      halo: "rgba(40, 86, 208, 0.12)",
      stroke: "#2856d0"
    }
  };

  const SIM = {
    charge: 640,
    linkDistance: 340,
    linkDistanceJitter: 160,
    linkStrength: 0.016,
    centerStrength: 0.0012,
    collisionPadding: 30,
    collisionStrength: 0.028,
    damping: 0.982,
    maxSpeed: 2.4,
    wallStrength: 0.035,
    alphaDecay: 0.01,
    minAlpha: 0.025,
    settleSpeed: 0.018,
    settleFrames: 24
  };

  const normalizeStatus = (status) => (status === "pending" ? "deal" : status);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const hexToRgb = (hex) => {
    if (!hex || typeof hex !== "string") return null;
    const normalized = hex.replace("#", "").trim();
    const expanded =
      normalized.length === 3
        ? normalized
            .split("")
            .map((char) => char + char)
            .join("")
        : normalized;
    if (expanded.length !== 6) return null;
    const num = Number.parseInt(expanded, 16);
    if (Number.isNaN(num)) return null;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  };

  const rgbaFromHex = (hex, alpha) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return `rgba(31, 35, 40, ${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  };

  const buildRadiusScale = (values, minRadius = 18, maxRadius = 34, exponent = 0.6) => {
    const clean = values.filter((value) => Number.isFinite(value));
    if (!clean.length) {
      const mid = (minRadius + maxRadius) / 2;
      return () => mid;
    }
    const minVal = Math.min(...clean);
    const maxVal = Math.max(...clean);
    if (minVal === maxVal) {
      const mid = (minRadius + maxRadius) / 2;
      return () => mid;
    }
    const minPow = Math.pow(minVal, exponent);
    const maxPow = Math.pow(maxVal, exponent);
    return (value) => {
      if (!Number.isFinite(value)) {
        return (minRadius + maxRadius) / 2;
      }
      const clamped = clamp(value, minVal, maxVal);
      const scaled = (Math.pow(clamped, exponent) - minPow) / (maxPow - minPow);
      return minRadius + scaled * (maxRadius - minRadius);
    };
  };

  function GraphCanvas({ data, title }) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const stateRef = useRef(null);
    const rafRef = useRef(0);

    useEffect(() => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const ctx = canvas.getContext("2d");
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      const valuationValues = data.nodes
        .map((node) => Number(node.valuation_b))
        .filter((value) => Number.isFinite(value));
      const radiusScale = buildRadiusScale(valuationValues, 24, 46, 0.6);

      const nodes = data.nodes.map((node) => {
        const valuation = Number(node.valuation_b);
        const baseRadius = radiusScale(valuation);
        return {
          id: node.id,
          label: node.label,
          valuation: Number.isFinite(valuation) ? valuation : null,
          brandColor: node.color || "#1f2328",
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          baseRadius,
          radius: baseRadius
        };
      });

      const nodeById = {};
      nodes.forEach((node) => {
        nodeById[node.id] = node;
      });

      const edges = data.edges.map((edge) => {
        const status = normalizeStatus(edge.status);
        const jitter = Math.random() - 0.5;
        return {
          status,
          provider: edge.provider,
          customer: edge.customer,
          source: nodeById[edge.provider],
          target: nodeById[edge.customer],
          jitter,
          length: Math.max(
            150,
            SIM.linkDistance + jitter * SIM.linkDistanceJitter
          )
        };
      });
      const linkEdges = edges.filter((edge) => edge.status !== "no_deal");

      const adjacencyOut = {};
      const adjacencyIn = {};
      nodes.forEach((node) => {
        adjacencyOut[node.id] = new Set();
        adjacencyIn[node.id] = new Set();
      });
      edges.forEach((edge) => {
        if (edge.status === "no_deal") return;
        adjacencyOut[edge.provider].add(edge.customer);
        adjacencyIn[edge.customer].add(edge.provider);
      });

      const state = {
        width: 0,
        height: 0,
        dpr,
        nodes,
        edges,
        adjacencyOut,
        adjacencyIn,
        nodeById,
        hoveredId: null,
        draggingId: null,
        pointerId: null,
        pointer: { x: 0, y: 0, px: 0, py: 0 },
        initialized: false,
        simAlpha: 1,
        stillFrames: 0
      };
      stateRef.current = state;

      const updateTitleSizing = () => {
        if (!title || !state.width || !state.height) return;
        const titleEl = wrap.querySelector(".canvas-title");
        if (!titleEl) return;
        const maxWidth = state.width * 0.88;
        const maxHeight = state.height * 0.24;
        let size = clamp(Math.min(state.width * 0.22, state.height * 0.26), 34, 240);
        wrap.style.setProperty("--title-max-width", `${Math.round(maxWidth)}px`);

        for (let i = 0; i < 4; i += 1) {
          wrap.style.setProperty("--title-size", `${size}px`);
          const rect = titleEl.getBoundingClientRect();
          const measuredWidth = Math.max(rect.width, titleEl.scrollWidth);
          const measuredHeight = rect.height;
          const scale = Math.min(
            1,
            maxWidth / (measuredWidth || 1),
            maxHeight / (measuredHeight || 1)
          );
          if (scale >= 0.995) break;
          size = Math.max(30, size * scale);
        }
      };

      const resize = () => {
        const rect = wrap.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        state.width = rect.width;
        state.height = rect.height;

        const minDim = Math.min(rect.width, rect.height);
        const radiusScaleFactor = clamp(minDim / 900, 0.88, 1.22);
        nodes.forEach((node) => {
          node.radius = node.baseRadius * radiusScaleFactor;
        });

        const baseDistance = clamp(minDim * 0.45, 240, 430);
        const jitterRange = baseDistance * 0.35;
        edges.forEach((edge) => {
          edge.length = Math.max(150, baseDistance + edge.jitter * jitterRange);
        });

        state.simAlpha = 1;
        state.stillFrames = 0;

        updateTitleSizing();

        if (!state.initialized) {
          const margin = Math.min(rect.width, rect.height) * 0.14;
          nodes.forEach((node) => {
            node.x = margin + Math.random() * (rect.width - margin * 2);
            node.y = margin + Math.random() * (rect.height - margin * 2);
            node.vx = (Math.random() - 0.5) * 1.5;
            node.vy = (Math.random() - 0.5) * 1.5;
          });
          state.initialized = true;
        }
      };

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(wrap);
      resize();

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          updateTitleSizing();
        });
      }

      const getPointer = (event) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
      };

      const getNodeAt = (x, y) => {
        let closest = null;
        let closestDist = Infinity;
        nodes.forEach((node) => {
          const dx = x - node.x;
          const dy = y - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < node.radius + 8 && dist < closestDist) {
            closest = node;
            closestDist = dist;
          }
        });
        return closest;
      };

      const onPointerDown = (event) => {
        const pos = getPointer(event);
        const node = getNodeAt(pos.x, pos.y);
        if (!node) {
          state.hoveredId = null;
          canvas.style.cursor = "default";
          return;
        }
        state.draggingId = node.id;
        state.simAlpha = 1;
        state.stillFrames = 0;
        state.pointerId = event.pointerId;
        state.pointer.x = pos.x;
        state.pointer.y = pos.y;
        state.pointer.px = pos.x;
        state.pointer.py = pos.y;
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      };

      const onPointerMove = (event) => {
        const pos = getPointer(event);
        if (pos.x < 0 || pos.y < 0 || pos.x > state.width || pos.y > state.height) {
          state.hoveredId = null;
          if (!state.draggingId) canvas.style.cursor = "default";
          return;
        }
        if (state.draggingId) {
          state.pointer.px = state.pointer.x;
          state.pointer.py = state.pointer.y;
          state.pointer.x = pos.x;
          state.pointer.y = pos.y;
          return;
        }
        const node = getNodeAt(pos.x, pos.y);
        state.hoveredId = node ? node.id : null;
        canvas.style.cursor = node ? "grab" : "default";
      };

      const onPointerUp = (event) => {
        if (!state.draggingId) return;
        const node = state.nodeById[state.draggingId];
        if (node) {
          const vx = (state.pointer.x - state.pointer.px) * 0.18;
          const vy = (state.pointer.y - state.pointer.py) * 0.18;
          node.vx += vx;
          node.vy += vy;
        }
        state.draggingId = null;
        if (state.pointerId !== null) {
          try {
            canvas.releasePointerCapture(state.pointerId);
          } catch (err) {
            // Ignore if capture is already released.
          }
        }
        state.pointerId = null;
        canvas.style.cursor = "default";
        state.simAlpha = 1;
        state.stillFrames = 0;
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);

      const roundedRect = (x, y, width, height, radius) => {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
      };

      const drawEdge = (edge, active, dimmed, direction, neutralMode) => {
        const style = STATUS_STYLES[edge.status] || STATUS_STYLES.no_deal;
        const alpha = EDGE_ALPHA[edge.status] || EDGE_ALPHA.no_deal;
        const directionStyle = direction ? HIGHLIGHT[direction] : null;
        const source = edge.source;
        const target = edge.target;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const startX = source.x + ux * (source.radius + 2);
        const startY = source.y + uy * (source.radius + 2);
        const endX = target.x - ux * (target.radius + 6);
        const endY = target.y - uy * (target.radius + 6);

        const isNoDeal = edge.status === "no_deal";
        if (!active && neutralMode) {
          ctx.setLineDash(style.dash || []);
          if (!isNoDeal) {
            const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
            gradient.addColorStop(0, "rgba(92, 107, 122, 0.18)");
            gradient.addColorStop(0.5, "rgba(92, 107, 122, 0.5)");
            gradient.addColorStop(1, "rgba(92, 107, 122, 0.18)");

            ctx.strokeStyle = gradient;
            ctx.lineWidth = style.width + 1.2;
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            ctx.strokeStyle = "rgba(92, 107, 122, 0.6)";
            ctx.lineWidth = style.width;
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          } else {
            ctx.strokeStyle = "rgba(190, 198, 210, 0.3)";
            ctx.lineWidth = style.width;
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          return;
        }

        if (active && !isNoDeal) {
          ctx.setLineDash([]);
          ctx.strokeStyle = directionStyle ? directionStyle.stroke : style.color;
          ctx.globalAlpha = 0.14;
          ctx.lineWidth = style.width + 5;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        }

        const inactiveColor = dimmed
          ? isNoDeal
            ? "rgba(190, 198, 210, 0.4)"
            : "rgba(146, 154, 166, 0.55)"
          : style.color;
        const activeColor = directionStyle ? directionStyle.stroke : style.color;
        ctx.strokeStyle = active ? activeColor : inactiveColor;
        ctx.lineWidth = active ? style.width + 1.1 : style.width;
        ctx.setLineDash(style.dash || []);
        ctx.globalAlpha = active ? alpha.active : dimmed ? alpha.dim : alpha.base;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        const showArrow = active && edge.status !== "no_deal";
        if (showArrow) {
          const arrowLength = 8;
          const arrowWidth = 5;
          const leftX = endX - ux * arrowLength - uy * arrowWidth;
          const leftY = endY - uy * arrowLength + ux * arrowWidth;
          const rightX = endX - ux * arrowLength + uy * arrowWidth;
          const rightY = endY - uy * arrowLength - ux * arrowWidth;

          ctx.setLineDash([]);
          ctx.fillStyle = activeColor;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(leftX, leftY);
          ctx.lineTo(rightX, rightY);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };

      const drawNode = (node, active, outgoing, incoming, dimmed, width, height, neutralMode) => {
        const isConnected = outgoing || incoming;
        const isBoth = outgoing && incoming;
        const radius = node.radius + (active ? 3 : isConnected ? 1.5 : 0);
        const showBoth = isBoth && !dimmed;
        const neutralBoost = neutralMode && !dimmed && !active && !isConnected;

        ctx.save();
        const baseAlpha = dimmed ? 0.52 : 1;
        ctx.globalAlpha = baseAlpha;

        if (active) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
          ctx.fill();
        }

        if (outgoing && !incoming) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
          ctx.fillStyle = HIGHLIGHT.outgoing.halo;
          ctx.fill();
        }

        if (incoming && !outgoing) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
          ctx.fillStyle = HIGHLIGHT.incoming.halo;
          ctx.fill();
        }

        if (isBoth && !dimmed) {
          ctx.save();
          ctx.globalAlpha = baseAlpha * 0.5;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0, 0, 0, 0.02)";
          ctx.fill();
          ctx.restore();
        }

        const brand = node.brandColor || "#1f2328";
        const fillNeutral = rgbaFromHex(brand, 0.14);
        const fillConnected = rgbaFromHex(brand, 0.2);
        const fillActive = rgbaFromHex(brand, 0.26);
        const fillDimmed = rgbaFromHex(brand, 0.18);
        const strokeNeutral = rgbaFromHex(brand, 0.85);
        const strokeActive = rgbaFromHex(brand, 0.95);
        const strokeDimmed = rgbaFromHex(brand, 0.5);

        let fill = dimmed ? fillDimmed : isConnected ? fillConnected : fillNeutral;
        let stroke = dimmed ? strokeDimmed : strokeNeutral;

        if (active) {
          fill = fillActive;
          stroke = strokeActive;
        }

        if (neutralBoost) {
          const neutralGradient = ctx.createRadialGradient(
            node.x - radius * 0.35,
            node.y - radius * 0.35,
            radius * 0.15,
            node.x,
            node.y,
            radius
          );
          neutralGradient.addColorStop(0, "rgba(255, 255, 255, 1)");
          neutralGradient.addColorStop(1, rgbaFromHex(brand, 0.2));
          fill = neutralGradient;
          stroke = strokeNeutral;
        }

        ctx.save();
        ctx.shadowColor = active
          ? rgbaFromHex(brand, 0.18)
          : isConnected
          ? rgbaFromHex(brand, 0.14)
          : neutralBoost
          ? rgbaFromHex(brand, 0.16)
          : "rgba(12, 16, 20, 0.08)";
        ctx.shadowBlur = active ? 14 : isConnected ? 11 : neutralBoost ? 12 : 7;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        const strokeWidth = active ? 2.4 : isConnected ? 2 : neutralBoost ? 2 : 1.7;
        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = dimmed ? 1.4 : strokeWidth;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        if (neutralBoost) {
          ctx.save();
          ctx.strokeStyle = rgbaFromHex(brand, 0.32);
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3.6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius - 1.6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        if (!dimmed && isConnected && !active) {
          const drawChevron = (dir, color) => {
            const size = 6;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.8;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            if (dir === "right") {
              ctx.moveTo(node.x - size * 0.4, node.y - size);
              ctx.lineTo(node.x + size, node.y);
              ctx.lineTo(node.x - size * 0.4, node.y + size);
            } else {
              ctx.moveTo(node.x + size * 0.4, node.y - size);
              ctx.lineTo(node.x - size, node.y);
              ctx.lineTo(node.x + size * 0.4, node.y + size);
            }
            ctx.stroke();
            ctx.restore();
          };

          const drawBiArrow = () => {
            const half = 8;
            const head = 4;
            ctx.save();
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = "#2a2f36";
            ctx.beginPath();
            ctx.moveTo(node.x - half, node.y);
            ctx.lineTo(node.x + half, node.y);
            ctx.stroke();

            ctx.strokeStyle = HIGHLIGHT.incoming.stroke;
            ctx.beginPath();
            ctx.moveTo(node.x - half, node.y);
            ctx.lineTo(node.x - half + head, node.y - head * 0.6);
            ctx.moveTo(node.x - half, node.y);
            ctx.lineTo(node.x - half + head, node.y + head * 0.6);
            ctx.stroke();

            ctx.strokeStyle = HIGHLIGHT.outgoing.stroke;
            ctx.beginPath();
            ctx.moveTo(node.x + half, node.y);
            ctx.lineTo(node.x + half - head, node.y - head * 0.6);
            ctx.moveTo(node.x + half, node.y);
            ctx.lineTo(node.x + half - head, node.y + head * 0.6);
            ctx.stroke();
            ctx.restore();
          };

          if (showBoth) {
            drawBiArrow();
          } else if (outgoing) {
            drawChevron("right", HIGHLIGHT.outgoing.stroke);
          } else if (incoming) {
            drawChevron("left", HIGHLIGHT.incoming.stroke);
          }
        }
        ctx.restore();

        const label = node.label;
        ctx.font = "600 12px 'Space Grotesk', sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const metrics = ctx.measureText(label);
        const labelWidth = metrics.width + 16;
        const labelHeight = 22;
        let labelX = node.x - labelWidth / 2;
        let labelY = node.y + radius + 12;
        if (labelY + labelHeight > height - 8) {
          labelY = node.y - radius - labelHeight - 10;
        }
        labelX = clamp(labelX, 8, width - labelWidth - 8);

        roundedRect(labelX, labelY, labelWidth, labelHeight, 10);
        ctx.fillStyle = dimmed
          ? "rgba(245, 245, 245, 0.86)"
          : active
          ? "rgba(255, 255, 255, 0.96)"
          : "rgba(255, 255, 255, 0.78)";
        ctx.fill();
        ctx.strokeStyle = dimmed ? "rgba(0, 0, 0, 0.12)" : "rgba(0, 0, 0, 0.05)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = dimmed ? "#606874" : "#111418";
        ctx.fillText(label, labelX + 8, labelY + labelHeight / 2 + 0.5);
        ctx.restore();
      };

      const tick = () => {
        const width = state.width;
        const height = state.height;
        if (!width || !height) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        const centerX = width / 2;
        const centerY = height / 2;
        const nodesCount = nodes.length;
        const simActive = state.draggingId || state.simAlpha > SIM.minAlpha;
        const forceScale = state.draggingId ? 1 : state.simAlpha;

        for (let i = 0; i < nodesCount; i += 1) {
          const node = nodes[i];
          node.ax = 0;
          node.ay = 0;
        }

        if (simActive) {
          for (let i = 0; i < nodesCount; i += 1) {
            const a = nodes[i];
            for (let j = i + 1; j < nodesCount; j += 1) {
              const b = nodes[j];
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const minDist = a.radius + b.radius + SIM.collisionPadding;
              const force = (SIM.charge * forceScale) / (dist * dist);
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              a.vx -= fx;
              a.vy -= fy;
              b.vx += fx;
              b.vy += fy;

              if (dist < minDist) {
                const overlap = (minDist - dist) / dist;
                const repel = overlap * SIM.collisionStrength * forceScale;
                const cx = (dx / dist) * repel;
                const cy = (dy / dist) * repel;
                a.vx -= cx;
                a.vy -= cy;
                b.vx += cx;
                b.vy += cy;
              }
            }
          }

          linkEdges.forEach((edge) => {
            const source = edge.source;
            const target = edge.target;
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const delta = dist - (edge.length || SIM.linkDistance);
            const force = delta * SIM.linkStrength * forceScale;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            source.vx += fx;
            source.vy += fy;
            target.vx -= fx;
            target.vy -= fy;
          });
        }

        let speedSum = 0;
        nodes.forEach((node) => {
          if (state.draggingId === node.id) {
            node.x = state.pointer.x;
            node.y = state.pointer.y;
            node.vx = 0;
            node.vy = 0;
            return;
          }

          if (!simActive) {
            node.vx = 0;
            node.vy = 0;
            return;
          }

          node.vx += (centerX - node.x) * SIM.centerStrength * forceScale;
          node.vy += (centerY - node.y) * SIM.centerStrength * forceScale;

          const padding = 44;
          const wallForce = SIM.wallStrength * forceScale;
          if (node.x < padding) node.vx += (padding - node.x) * wallForce;
          if (node.x > width - padding) node.vx -= (node.x - (width - padding)) * wallForce;
          if (node.y < padding) node.vy += (padding - node.y) * wallForce;
          if (node.y > height - padding) node.vy -= (node.y - (height - padding)) * wallForce;

          node.vx *= SIM.damping;
          node.vy *= SIM.damping;
          node.vx = clamp(node.vx, -SIM.maxSpeed, SIM.maxSpeed);
          node.vy = clamp(node.vy, -SIM.maxSpeed, SIM.maxSpeed);
          node.x += node.vx;
          node.y += node.vy;
          speedSum += Math.hypot(node.vx, node.vy);
        });

        if (state.draggingId) {
          state.simAlpha = 1;
          state.stillFrames = 0;
        } else if (simActive) {
          const avgSpeed = speedSum / nodesCount;
          if (avgSpeed < SIM.settleSpeed) {
            state.stillFrames += 1;
          } else {
            state.stillFrames = 0;
          }
          if (state.stillFrames > SIM.settleFrames) {
            state.simAlpha = 0;
          } else {
            state.simAlpha = Math.max(0, state.simAlpha - SIM.alphaDecay);
          }
        }

        ctx.clearRect(0, 0, width, height);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const highlightId = state.draggingId;
        const hasFocus = Boolean(state.draggingId);
        const neutralMode = !hasFocus;
        const outSet = highlightId ? state.adjacencyOut[highlightId] : null;
        const inSet = highlightId ? state.adjacencyIn[highlightId] : null;
        const focusSet = highlightId ? new Set([highlightId]) : null;
        if (focusSet && outSet) outSet.forEach((id) => focusSet.add(id));
        if (focusSet && inSet) inSet.forEach((id) => focusSet.add(id));

        edges.forEach((edge) => {
          const isRelevant = edge.status !== "no_deal";
          const isOutgoing = highlightId && edge.provider === highlightId && isRelevant;
          const isIncoming = highlightId && edge.customer === highlightId && isRelevant;
          const isActive = isOutgoing || isIncoming;
          if (isActive) return;
          const dimmed = hasFocus;
          drawEdge(edge, false, dimmed, null, neutralMode);
        });

        edges.forEach((edge) => {
          const isRelevant = edge.status !== "no_deal";
          const isOutgoing = highlightId && edge.provider === highlightId && isRelevant;
          const isIncoming = highlightId && edge.customer === highlightId && isRelevant;
          const isActive = isOutgoing || isIncoming;
          if (!isActive) return;
          const direction = isOutgoing ? "outgoing" : "incoming";
          drawEdge(edge, true, false, direction, neutralMode);
        });

        const dimmedNodes = [];
        const connectedNodes = [];
        let activeNode = null;

        nodes.forEach((node) => {
          const isActive = highlightId && node.id === highlightId;
          const isOutgoing = highlightId && outSet && outSet.has(node.id);
          const isIncoming = highlightId && inSet && inSet.has(node.id);
          const dimmed = hasFocus && focusSet && !focusSet.has(node.id);
          if (isActive) {
            activeNode = { node, isOutgoing, isIncoming, dimmed };
            return;
          }
          if (isOutgoing || isIncoming) {
            connectedNodes.push({ node, isOutgoing, isIncoming, dimmed });
            return;
          }
          dimmedNodes.push({ node, isOutgoing, isIncoming, dimmed });
        });

        dimmedNodes.forEach((item) => {
          drawNode(
            item.node,
            false,
            item.isOutgoing,
            item.isIncoming,
            item.dimmed,
            width,
            height,
            neutralMode
          );
        });
        connectedNodes.forEach((item) => {
          drawNode(
            item.node,
            false,
            item.isOutgoing,
            item.isIncoming,
            item.dimmed,
            width,
            height,
            neutralMode
          );
        });
        if (activeNode) {
          drawNode(
            activeNode.node,
            true,
            activeNode.isOutgoing,
            activeNode.isIncoming,
            activeNode.dimmed,
            width,
            height,
            neutralMode
          );
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(rafRef.current);
        resizeObserver.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
      };
    }, [data]);

    return React.createElement(
      "div",
      { className: "canvas-wrap", ref: wrapRef },
      React.createElement("canvas", { ref: canvasRef }),
      React.createElement("div", { className: "canvas-title" }, title),
      React.createElement(
        "div",
        { className: "canvas-legend" },
        React.createElement(
          "div",
          { className: "canvas-legend-item" },
          React.createElement(
            "span",
            {
              className: "canvas-legend-icon",
              style: {
                color: "#fff",
                background: `linear-gradient(120deg, ${HIGHLIGHT.outgoing.stroke}, #33b7a5)`,
                borderColor: "rgba(24, 143, 124, 0.45)"
              }
            },
            "→"
          ),
          React.createElement("span", null, "Customer")
        ),
        React.createElement(
          "div",
          { className: "canvas-legend-item" },
          React.createElement(
            "span",
            {
              className: "canvas-legend-icon",
              style: {
                color: "#fff",
                background: `linear-gradient(120deg, ${HIGHLIGHT.incoming.stroke}, #5c86ff)`,
                borderColor: "rgba(40, 86, 208, 0.45)"
              }
            },
            "←"
          ),
          React.createElement("span", null, "Supplier")
        ),
          React.createElement(
            "div",
            { className: "canvas-legend-item" },
            React.createElement(
              "span",
              {
                className: "canvas-legend-icon both",
                style: {
                  color: "#fff",
                  background: "linear-gradient(120deg, #2856d0, #188f7c)",
                  borderColor: "rgba(42, 47, 54, 0.4)"
                }
              },
              "↔"
            ),
            React.createElement("span", null, "Both")
          )
      )
    );
  }

  function App() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
      fetch("./graph.json")
        .then((response) => {
          if (!response.ok) throw new Error("Failed to load graph.json");
          return response.json();
        })
        .then((payload) => {
          setData(payload);
        })
        .catch((err) => {
          setError(err.message || "Failed to load data");
        });
    }, []);

    if (error) {
      return React.createElement(
        "div",
        { className: "app" },
        React.createElement(
          "div",
          { className: "title-block" },
          React.createElement("h1", null, "Mutual Dependencies"),
          React.createElement(
            "p",
            null,
            "Unable to load graph data. Run a local server and refresh."
          ),
          React.createElement("p", { className: "badge" }, error)
        )
      );
    }

    if (!data) {
      return React.createElement(
        "div",
        { className: "app" },
        React.createElement(
          "div",
          { className: "title-block" },
          React.createElement("h1", null, "Mutual Dependencies"),
          React.createElement("p", null, "Loading the graph data..."),
          React.createElement("div", { className: "badge" }, "Graph loading")
        )
      );
    }

    return React.createElement(
      "div",
      { className: "app" },
      React.createElement(GraphCanvas, { data, title: data.metadata.title })
    );
  }

  const rootElement = document.getElementById("root");
  const root = ReactDOM.createRoot
    ? ReactDOM.createRoot(rootElement)
    : null;

  if (root) {
    root.render(React.createElement(App));
  } else {
    ReactDOM.render(React.createElement(App), rootElement);
  }
})();
