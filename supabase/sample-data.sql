-- Optional: sample records so you can test the portal before importing the real register.
-- Replace YOUR-EMAIL@example.com with an email you can receive, run this, then invite that
-- email from Supabase → Authentication → Users → Invite user. Delete these rows before launch.

with fam as (
  insert into public.families (family_name, member_number, address_line1, city, state, zip, home_phone, prayer_group, home_parish, member_since)
  values ('Sample Family', 'MTCA-0001', '123 Example St', 'Atlanta', 'GA', '30301', '(404) 555-0100', 'North Area', 'Kozhencherry', '2015-06-01')
  returning id
), mem as (
  insert into public.members (family_id, first_name, last_name, email, mobile_phone, relationship, role, directory_opt_in)
  select id, 'Test', 'Member', 'YOUR-EMAIL@example.com', '(404) 555-0101', 'head', 'admin', true from fam
  returning id, family_id
)
insert into public.contributions (family_id, given_on, category, amount, method, reference)
select family_id, d::date, 'Subscription', 100, 'Check', 'Sample'
from mem, generate_series(date_trunc('year', now()), now(), interval '1 month') d;

insert into public.member_announcements (title, body)
values ('Welcome to the member portal', 'You can now update your family details and view your contribution statement online.');
