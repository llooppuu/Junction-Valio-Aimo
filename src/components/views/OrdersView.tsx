import PageHero from '../ui/PageHero.tsx';
import { EmptyState } from '../ui/Card.tsx';
import { useDemoState } from '../../lib/demo-state.tsx';
import { formatEuro } from '../../lib/format.ts';
import { getKitchen } from '../../data/mock.ts';
import '../../styles/orders.css';

export default function OrdersView() {
  const { orders } = useDemoState();

  return (
    <>
      <PageHero title="Orders" lead="Every order placed from an authorized quote." />

      <div className="container page-body orders">
        <p className="orders__intro">
          Each order comes from one quote that was within the agent's limit or approved by you, and each quote can become
          at most one order.
        </p>

        {orders.length === 0 ? (
          <EmptyState title="No orders yet">
            Ask the agent for something in the workspace. Orders it places appear here.
          </EmptyState>
        ) : (
          <div className="table-wrap orders__table-wrap">
            <table className="data-table orders__table">
              <caption className="visually-hidden">Orders placed from authorized quotes, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Quote</th>
                  <th scope="col">Kitchen</th>
                  <th scope="col">What</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                  <th scope="col">Placed</th>
                  <th scope="col">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <th scope="row" className="orders__id">
                      {order.id}
                    </th>
                    <td className="orders__id">{order.quoteId}</td>
                    <td>{getKitchen(order.kitchenId).name}</td>
                    <td>{order.summary}</td>
                    <td className="num">{formatEuro(order.total)}</td>
                    <td>{order.placedAt}</td>
                    <td>{order.deliveryDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
