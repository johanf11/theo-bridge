-- Per-client fee configuration
-- fee_bps: Theo's all-in margin charged on top of the interbank rate
-- Default 150 = 1.50%. Range: 100 (1.00%) to 300 (3.00%).
-- corridor_bps: MoneyGram/partner cost, stored for transparency in fee breakdown.
-- Default 70 = 0.70%.

alter table customers
  add column if not exists fee_bps       integer not null default 150
    check (fee_bps between 0 and 500),
  add column if not exists corridor_bps  integer not null default 70
    check (corridor_bps between 0 and 500);

comment on column customers.fee_bps      is 'Theo service fee in basis points (150 = 1.50%)';
comment on column customers.corridor_bps is 'MoneyGram/corridor cost in basis points (70 = 0.70%)';
