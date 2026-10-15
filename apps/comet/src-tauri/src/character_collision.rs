use crate::desktop_geometry::{Edge, Rect};
use serde::Deserialize;
use std::sync::Arc;

const MAX_BOUNDS: f64 = 520.0;
const MAX_CELLS: usize = 512;
const EDGE_EPSILON: f64 = 1e-8;

#[derive(Deserialize)]
pub(crate) struct Mask {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub columns: usize,
    pub rows: usize,
    pub bits: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
struct Run {
    from: u16,
    to: u16,
}

#[derive(Clone, Debug)]
pub(crate) struct Shape {
    pub bounds: Rect,
    horizontal: Vec<Vec<Run>>,
    vertical: Vec<Vec<Run>>,
    cell_width: f64,
    cell_height: f64,
}

#[derive(Clone, Debug)]
pub(crate) struct Collider {
    pub shape: Arc<Shape>,
    pub origin: (f64, f64),
    pub scale: f64,
}

fn boundary_runs(length: usize, boundary: impl Fn(usize) -> bool) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut start = None;
    for index in 0..length {
        if boundary(index) {
            start.get_or_insert(index);
        } else if let Some(from) = start.take() {
            runs.push(Run {
                from: from as u16,
                to: index as u16,
            });
        }
    }
    if let Some(from) = start {
        runs.push(Run {
            from: from as u16,
            to: length as u16,
        });
    }
    runs
}

impl Shape {
    pub fn from_mask(mask: Mask) -> Result<Self, String> {
        if ![mask.x, mask.y, mask.width, mask.height]
            .into_iter()
            .all(f64::is_finite)
            || mask.x < 0.0
            || mask.y < 0.0
            || mask.width <= 0.0
            || mask.height <= 0.0
            || mask.x + mask.width > MAX_BOUNDS
            || mask.y + mask.height > MAX_BOUNDS
            || !(1..=MAX_CELLS).contains(&mask.columns)
            || !(1..=MAX_CELLS).contains(&mask.rows)
        {
            return Err("캐릭터 충돌 영역의 크기나 위치가 올바르지 않아요.".into());
        }
        if mask.bits.len() != (mask.columns * mask.rows).div_ceil(8) {
            return Err("캐릭터 충돌 영역의 픽셀 정보가 올바르지 않아요.".into());
        }

        let opaque = |column: usize, row: usize| {
            let index = row * mask.columns + column;
            mask.bits[index / 8] & (1 << (index % 8)) != 0
        };
        let horizontal = (0..=mask.rows)
            .map(|row| {
                boundary_runs(mask.columns, |column| {
                    let above = row > 0 && opaque(column, row - 1);
                    let below = row < mask.rows && opaque(column, row);
                    above != below
                })
            })
            .collect();
        let vertical = (0..=mask.columns)
            .map(|column| {
                boundary_runs(mask.rows, |row| {
                    let left = column > 0 && opaque(column - 1, row);
                    let right = column < mask.columns && opaque(column, row);
                    left != right
                })
            })
            .collect();

        Ok(Self {
            bounds: Rect {
                x: mask.x,
                y: mask.y,
                width: mask.width,
                height: mask.height,
            },
            horizontal,
            vertical,
            cell_width: mask.width / mask.columns as f64,
            cell_height: mask.height / mask.rows as f64,
        })
    }

    pub fn append_edges(
        &self,
        origin: (f64, f64),
        scale: f64,
        query: Rect,
        output: &mut Vec<Edge>,
    ) {
        let origin = (
            origin.0 + self.bounds.x * scale,
            origin.1 + self.bounds.y * scale,
        );
        let cell_size = (self.cell_width * scale, self.cell_height * scale);
        let right = origin.0 + self.bounds.width * scale;
        let bottom = origin.1 + self.bounds.height * scale;
        let query_right = query.x + query.width;
        let query_bottom = query.y + query.height;
        if ![
            origin.0,
            origin.1,
            scale,
            cell_size.0,
            cell_size.1,
            right,
            bottom,
            query.x,
            query.y,
            query.width,
            query.height,
            query_right,
            query_bottom,
        ]
        .into_iter()
        .all(f64::is_finite)
            || scale <= 0.0
            || cell_size.0 <= 0.0
            || cell_size.1 <= 0.0
            || query.width < 0.0
            || query.height < 0.0
            || query_right < origin.0 - EDGE_EPSILON
            || query_bottom < origin.1 - EDGE_EPSILON
            || query.x > right + EDGE_EPSILON
            || query.y > bottom + EDGE_EPSILON
        {
            return;
        }

        append_indexed_edges(&self.horizontal, true, origin, cell_size, query, output);
        append_indexed_edges(&self.vertical, false, origin, cell_size, query, output);
    }
}

fn append_indexed_edges(
    index: &[Vec<Run>],
    horizontal: bool,
    origin: (f64, f64),
    cell_size: (f64, f64),
    query: Rect,
    output: &mut Vec<Edge>,
) {
    let (axis_origin, axis_step, span_origin, span_step) = if horizontal {
        (origin.1, cell_size.1, origin.0, cell_size.0)
    } else {
        (origin.0, cell_size.0, origin.1, cell_size.1)
    };
    let (axis_min, axis_max, span_min, span_max) = if horizontal {
        (
            query.y,
            query.y + query.height,
            query.x,
            query.x + query.width,
        )
    } else {
        (
            query.x,
            query.x + query.width,
            query.y,
            query.y + query.height,
        )
    };
    let axis_min = axis_min - EDGE_EPSILON;
    let axis_max = axis_max + EDGE_EPSILON;
    let span_min = span_min - EDGE_EPSILON;
    let span_max = span_max + EDGE_EPSILON;
    let last = (index.len() - 1) as f64;
    let first_row = ((axis_min - axis_origin) / axis_step)
        .floor()
        .clamp(0.0, last) as usize;
    let last_row = ((axis_max - axis_origin) / axis_step)
        .ceil()
        .clamp(0.0, last) as usize;

    for (offset, runs) in index[first_row..=last_row].iter().enumerate() {
        let row = first_row + offset;
        let axis = axis_origin + row as f64 * axis_step;
        if axis < axis_min || axis > axis_max {
            continue;
        }
        let first_run =
            runs.partition_point(|run| span_origin + run.to as f64 * span_step < span_min);
        for run in &runs[first_run..] {
            let from = span_origin + run.from as f64 * span_step;
            if from > span_max {
                break;
            }
            output.push(Edge {
                horizontal,
                axis,
                from,
                to: span_origin + run.to as f64 * span_step,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mask(pixels: &[&str]) -> Mask {
        let columns = pixels[0].len();
        let rows = pixels.len();
        let mut bits = vec![0; (columns * rows).div_ceil(8)];
        for (row, pixels) in pixels.iter().enumerate() {
            assert_eq!(pixels.len(), columns);
            for (column, pixel) in pixels.bytes().enumerate() {
                if pixel == b'#' {
                    let index = row * columns + column;
                    bits[index / 8] |= 1 << (index % 8);
                }
            }
        }
        Mask {
            x: 0.0,
            y: 0.0,
            width: columns as f64,
            height: rows as f64,
            columns,
            rows,
            bits,
        }
    }

    fn all_edges(shape: &Shape) -> Vec<(bool, f64, f64, f64)> {
        let mut edges = Vec::new();
        shape.append_edges((0.0, 0.0), 1.0, shape.bounds, &mut edges);
        edges
            .into_iter()
            .map(|edge| (edge.horizontal, edge.axis, edge.from, edge.to))
            .collect()
    }

    #[test]
    fn transparent_padding_and_holes_keep_their_actual_contours() {
        let shape = Shape::from_mask(mask(&[".....", ".###.", ".#.#.", ".###.", "....."])).unwrap();
        assert_eq!(
            all_edges(&shape),
            vec![
                (true, 1.0, 1.0, 4.0),
                (true, 2.0, 2.0, 3.0),
                (true, 3.0, 2.0, 3.0),
                (true, 4.0, 1.0, 4.0),
                (false, 1.0, 1.0, 4.0),
                (false, 2.0, 2.0, 3.0),
                (false, 3.0, 2.0, 3.0),
                (false, 4.0, 1.0, 4.0),
            ]
        );
        let empty = Shape::from_mask(mask(&["...", "..."])).unwrap();
        assert!(all_edges(&empty).is_empty());
    }

    #[test]
    fn a_solid_mask_merges_to_four_edges() {
        let mut mask = mask(&["#####", "#####", "#####", "#####"]);
        mask.x = 5.0;
        mask.y = 7.0;
        mask.width = 50.0;
        mask.height = 40.0;
        let shape = Shape::from_mask(mask).unwrap();
        assert_eq!(
            all_edges(&shape),
            vec![
                (true, 7.0, 5.0, 55.0),
                (true, 47.0, 5.0, 55.0),
                (false, 5.0, 7.0, 47.0),
                (false, 55.0, 7.0, 47.0),
            ]
        );
    }

    #[test]
    fn translation_scale_and_endpoint_queries_use_world_coordinates() {
        let mut mask = mask(&["##", "##"]);
        mask.x = 10.0;
        mask.y = 20.0;
        mask.width = 8.0;
        mask.height = 6.0;
        let shape = Shape::from_mask(mask).unwrap();
        let mut edges = Vec::new();
        shape.append_edges(
            (-200.25, 80.5),
            1.5,
            Rect {
                x: -173.25 + 1e-10,
                y: 119.5,
                width: 0.0,
                height: 0.0,
            },
            &mut edges,
        );
        assert_eq!(edges.len(), 2);
        assert!(edges.iter().any(|edge| {
            edge.horizontal && edge.axis == 119.5 && edge.from == -185.25 && edge.to == -173.25
        }));
        assert!(edges.iter().any(|edge| {
            !edge.horizontal && edge.axis == -173.25 && edge.from == 110.5 && edge.to == 119.5
        }));
    }

    #[test]
    fn a_local_query_retrieves_only_nearby_runs_from_a_large_mask() {
        let mut bits = vec![0; 512 * 512 / 8];
        for row in (0..512).step_by(4) {
            for column in (0..512).step_by(4) {
                let index = row * 512 + column;
                bits[index / 8] |= 1 << (index % 8);
            }
        }
        let shape = Shape::from_mask(Mask {
            x: 0.0,
            y: 0.0,
            width: 512.0,
            height: 512.0,
            columns: 512,
            rows: 512,
            bits,
        })
        .unwrap();
        assert!(shape.horizontal.iter().map(Vec::len).sum::<usize>() > 10_000);
        let mut edges = Vec::new();
        shape.append_edges(
            (0.0, 0.0),
            1.0,
            Rect {
                x: 500.0,
                y: 500.0,
                width: 1.0,
                height: 1.0,
            },
            &mut edges,
        );
        assert_eq!(edges.len(), 4);
        assert!(edges.iter().all(|edge| {
            [500.0, 501.0].contains(&edge.axis) && edge.from == 500.0 && edge.to == 501.0
        }));
    }

    #[test]
    fn malformed_bounds_dimensions_and_bit_lengths_are_rejected() {
        for invalid in [f64::NAN, f64::INFINITY, -1.0] {
            let mut mask = mask(&["#"]);
            mask.x = invalid;
            assert!(Shape::from_mask(mask).is_err());
        }
        for width in [0.0, -1.0, 521.0, f64::NEG_INFINITY] {
            let mut mask = mask(&["#"]);
            mask.width = width;
            assert!(Shape::from_mask(mask).is_err());
        }
        let mut outside = mask(&["#"]);
        outside.y = 520.0;
        assert!(Shape::from_mask(outside).is_err());
        for (columns, rows) in [(0, 1), (1, 0), (513, 1), (1, 513)] {
            let mut mask = mask(&["#"]);
            mask.columns = columns;
            mask.rows = rows;
            assert!(Shape::from_mask(mask).is_err());
        }
        for bits in [vec![], vec![1, 0]] {
            let mut mask = mask(&["#"]);
            mask.bits = bits;
            assert!(Shape::from_mask(mask).is_err());
        }
        let shape = Shape::from_mask(mask(&["........#"])).unwrap();
        assert_eq!(
            all_edges(&shape),
            vec![
                (true, 0.0, 8.0, 9.0),
                (true, 1.0, 8.0, 9.0),
                (false, 8.0, 0.0, 1.0),
                (false, 9.0, 0.0, 1.0),
            ]
        );
    }
}
